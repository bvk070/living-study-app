import {
  GenerateDocumentSectionsParams,
  GenerateDocumentSectionsResponse,
  RetrySectionGenerationParams,
  RetrySectionGenerationResponse,
} from "@workspace/api-zod";
import {
  db,
  pendingCardSourcesTable,
  pendingStudyCardsTable,
  studySectionsTable,
  studySentencesTable,
} from "@workspace/db";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { InvalidModelJsonError, generateSectionCards } from "../../lib/studyCardGenerator";
import { getOwnedDocument } from "./documents";

const router: IRouter = Router();

interface SectionJob {
  documentId: string;
  sectionId: string;
}

interface ProcessorResult {
  cards?: Awaited<ReturnType<typeof generateSectionCards>>;
  failure?: string;
}

function sectionStatus(section: {
  id: string;
  generationStatus: string;
  uncoveredSentenceCount: number;
  generatedCardCount: number;
  generationError: string | null;
}) {
  return {
    sectionId: section.id,
    status: section.generationStatus,
    uncoveredSentenceCount: section.uncoveredSentenceCount,
    generatedCardCount: section.generatedCardCount,
    error: section.generationError,
  };
}

async function runSectionJob({ documentId, sectionId }: SectionJob): Promise<void> {
  try {
    const [section] = await db
      .select()
      .from(studySectionsTable)
      .where(and(
        eq(studySectionsTable.id, sectionId),
        eq(studySectionsTable.documentId, documentId),
      ))
      .limit(1);
    if (!section) return;

    const sentences = await db
      .select({ id: studySentencesTable.id, text: studySentencesTable.text })
      .from(studySentencesTable)
      .where(eq(studySentencesTable.sectionId, sectionId))
      .orderBy(asc(studySentencesTable.documentOrder));

    if (sentences.length === 0) {
      await db.update(studySectionsTable).set({
        generationStatus: "failed",
        generationError: "This section has no parsed sentences.",
        updatedAt: new Date(),
      }).where(eq(studySectionsTable.id, sectionId));
      return;
    }

    const [result] = await batchProcess(
      [{ sentences }],
      async ({ sentences: input }): Promise<ProcessorResult> => {
        try {
          return { cards: await generateSectionCards(input) };
        } catch (error) {
          if (error instanceof InvalidModelJsonError) {
            return { failure: "The model returned invalid JSON twice." };
          }
          throw error;
        }
      },
      { concurrency: 1, retries: 1, minTimeout: 1000, maxTimeout: 8000 },
    );

    if (!result || result.failure) {
      await db.update(studySectionsTable).set({
        generationStatus: "failed",
        generationError: result?.failure ?? "Generation failed.",
        updatedAt: new Date(),
      }).where(eq(studySectionsTable.id, sectionId));
      return;
    }

    const cards = result.cards ?? [];
    const coveredSentenceIds = new Set(cards.flatMap((card) => card.sourceSentenceIds));
    const uncoveredSentenceCount = sentences.filter((sentence) => !coveredSentenceIds.has(sentence.id)).length;

    await db.transaction(async (tx) => {
      for (const card of cards) {
        const [saved] = await tx.insert(pendingStudyCardsTable).values({
          documentId,
          sectionId,
          kind: card.kind,
          front: card.front,
          answer: card.answer,
          quizOptions: card.quizOptions,
          correctAnswer: card.correctAnswer,
        }).returning({ id: pendingStudyCardsTable.id });
        await tx.insert(pendingCardSourcesTable).values(card.sourceSentenceIds.map((sentenceId) => ({
          itemId: saved.id,
          sentenceId,
        })));
      }
      await tx.update(studySectionsTable).set({
        generationStatus: "done",
        generationError: null,
        generatedCardCount: cards.length,
        uncoveredSentenceCount,
        updatedAt: new Date(),
      }).where(eq(studySectionsTable.id, sectionId));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    await db.update(studySectionsTable).set({
      generationStatus: "failed",
      generationError: message.slice(0, 500),
      updatedAt: new Date(),
    }).where(eq(studySectionsTable.id, sectionId));
  }
}

async function runSectionJobs(jobs: SectionJob[]): Promise<void> {
  await batchProcess(
    jobs,
    async (job) => {
      await runSectionJob(job);
      return true;
    },
    { concurrency: 2, retries: 0 },
  );
}

async function getDocumentSectionStatuses(documentId: string) {
  const sections = await db
    .select()
    .from(studySectionsTable)
    .where(eq(studySectionsTable.documentId, documentId))
    .orderBy(asc(studySectionsTable.sectionOrder));
  return sections.map(sectionStatus);
}

function ensureUser(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

router.post("/documents/:documentId/generate", async (req: Request, res: Response): Promise<void> => {
  const ownerId = ensureUser(req, res);
  if (!ownerId) return;
  const params = GenerateDocumentSectionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const document = await getOwnedDocument(params.data.documentId, ownerId);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }

  const pendingSections = await db
    .update(studySectionsTable)
    .set({ generationStatus: "generating", generationError: null, updatedAt: new Date() })
    .where(and(
      eq(studySectionsTable.documentId, document.id),
      eq(studySectionsTable.generationStatus, "pending"),
    ))
    .returning({ id: studySectionsTable.id });

  void runSectionJobs(pendingSections.map((section) => ({
    documentId: document.id,
    sectionId: section.id,
  })));
  res.status(202).json(GenerateDocumentSectionsResponse.parse({
    sections: await getDocumentSectionStatuses(document.id),
  }));
});

router.post("/documents/:documentId/sections/:sectionId/generate", async (req: Request, res: Response): Promise<void> => {
  const ownerId = ensureUser(req, res);
  if (!ownerId) return;
  const params = RetrySectionGenerationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const document = await getOwnedDocument(params.data.documentId, ownerId);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  const [section] = await db
    .update(studySectionsTable)
    .set({ generationStatus: "generating", generationError: null, updatedAt: new Date() })
    .where(and(
      eq(studySectionsTable.id, params.data.sectionId),
      eq(studySectionsTable.documentId, document.id),
      eq(studySectionsTable.generationStatus, "failed"),
    ))
    .returning();
  if (!section) {
    const [existing] = await db
      .select()
      .from(studySectionsTable)
      .where(and(
        eq(studySectionsTable.id, params.data.sectionId),
        eq(studySectionsTable.documentId, document.id),
      ))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Section not found." });
      return;
    }
    res.status(409).json({ error: `Section is ${existing.generationStatus}; only failed sections can be retried.` });
    return;
  }
  void runSectionJobs([{ documentId: document.id, sectionId: section.id }]);
  res.status(202).json(RetrySectionGenerationResponse.parse(sectionStatus(section)));
});

export default router;
