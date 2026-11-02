import {
  DeleteDocumentParams,
  GetDocumentParams,
  GetDocumentResponse,
  ImportDocumentBody,
  ImportDocumentResponse,
  ListDocumentsResponse,
} from "@workspace/api-zod";
import { db, studyDocumentsTable, studySectionsTable, studySentencesTable, uploadIntentsTable } from "@workspace/db";
import { ObjectPermission } from "../../lib/objectAcl";
import { ObjectStorageService } from "../../lib/objectStorage";
import { parseStudyPdf } from "../../lib/pdfParser";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function ensureUser(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

export async function getOwnedDocument(documentId: string, ownerId: string) {
  const [document] = await db
    .select()
    .from(studyDocumentsTable)
    .where(and(
      eq(studyDocumentsTable.id, documentId),
      eq(studyDocumentsTable.ownerId, ownerId),
    ))
    .limit(1);
  return document;
}

async function documentDetail(document: NonNullable<Awaited<ReturnType<typeof getOwnedDocument>>>) {
  const sections = await db
    .select()
    .from(studySectionsTable)
    .where(eq(studySectionsTable.documentId, document.id))
    .orderBy(asc(studySectionsTable.sectionOrder));
  const sentences = await db
    .select()
    .from(studySentencesTable)
    .innerJoin(studySectionsTable, eq(studySentencesTable.sectionId, studySectionsTable.id))
    .where(eq(studySectionsTable.documentId, document.id))
    .orderBy(asc(studySentencesTable.documentOrder));
  const sentenceGroups = new Map<string, typeof sentences>();
  for (const sentence of sentences) {
    const group = sentenceGroups.get(sentence.study_sentences.sectionId) ?? [];
    group.push(sentence);
    sentenceGroups.set(sentence.study_sentences.sectionId, group);
  }

  return GetDocumentResponse.parse({
    document: {
      id: document.id,
      name: document.name,
      pageCount: document.pageCount,
      status: document.status,
      createdAt: document.createdAt,
      sectionCount: sections.length,
      sentenceCount: sentences.length,
    },
    sections: sections.map((section) => {
      const group = sentenceGroups.get(section.id) ?? [];
      return {
        id: section.id,
        title: section.title,
        order: section.sectionOrder,
        sentenceCount: group.length,
        previewSentences: group.slice(0, 6).map(({ study_sentences: sentence }) => ({
          text: sentence.text,
          subheading: sentence.subheading,
          order: sentence.documentOrder,
        })),
        generatedCardCount: section.generatedCardCount,
        uncoveredSentenceCount: section.uncoveredSentenceCount,
        status: section.generationStatus,
        error: section.generationError,
      };
    }),
  });
}

router.get("/documents", async (req: Request, res: Response): Promise<void> => {
  const ownerId = ensureUser(req, res);
  if (!ownerId) return;

  const documents = await db
    .select()
    .from(studyDocumentsTable)
    .where(eq(studyDocumentsTable.ownerId, ownerId))
    .orderBy(sql`${studyDocumentsTable.createdAt} DESC`);
  const totals = await db
    .select({
      documentId: studySectionsTable.documentId,
      sectionCount: sql<number>`count(distinct ${studySectionsTable.id})::int`,
      sentenceCount: sql<number>`count(${studySentencesTable.id})::int`,
    })
    .from(studySectionsTable)
    .innerJoin(studyDocumentsTable, eq(studyDocumentsTable.id, studySectionsTable.documentId))
    .leftJoin(studySentencesTable, eq(studySentencesTable.sectionId, studySectionsTable.id))
    .where(eq(studyDocumentsTable.ownerId, ownerId))
    .groupBy(studySectionsTable.documentId);
  const totalMap = new Map(totals.map((row) => [row.documentId, row]));

  res.json(ListDocumentsResponse.parse(documents.map((document) => {
    const total = totalMap.get(document.id);
    return {
      id: document.id,
      name: document.name,
      pageCount: document.pageCount,
      status: document.status,
      createdAt: document.createdAt,
      sectionCount: total?.sectionCount ?? 0,
      sentenceCount: total?.sentenceCount ?? 0,
    };
  })));
});

router.post("/documents/import", async (req: Request, res: Response): Promise<void> => {
  const ownerId = ensureUser(req, res);
  if (!ownerId) return;

  const parsedBody = ImportDocumentBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }
  const { name, objectPath } = parsedBody.data;
  const [intent] = await db
    .select()
    .from(uploadIntentsTable)
    .where(and(
      eq(uploadIntentsTable.objectPath, objectPath),
      eq(uploadIntentsTable.ownerId, ownerId),
      gt(uploadIntentsTable.expiresAt, new Date()),
    ))
    .limit(1);
  if (!intent) {
    res.status(404).json({ error: "Upload was not found or has expired." });
    return;
  }

  try {
    const file = await objectStorage.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    const actualSize = Number(metadata.size ?? 0);
    if (actualSize < 5 || actualSize > MAX_UPLOAD_BYTES || actualSize !== intent.size) {
      res.status(422).json({ error: "The uploaded PDF has an invalid size." });
      return;
    }
    const [buffer] = await file.download();
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      res.status(422).json({ error: "The uploaded file is not a readable PDF." });
      return;
    }

    let parsedPdf;
    try {
      parsedPdf = await parseStudyPdf(new Uint8Array(buffer));
    } catch (error) {
      res.status(422).json({
        error: error instanceof Error ? error.message : "Could not parse this PDF.",
      });
      return;
    }

    await objectStorage.trySetObjectEntityAclPolicy(objectPath, {
      owner: ownerId,
      visibility: "private",
    });

    const [document] = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(studyDocumentsTable)
        .values({
          ownerId,
          name: name.slice(0, 255),
          objectPath,
          pageCount: parsedPdf.pageCount,
          status: "parsed",
        })
        .returning();

      for (const parsedSection of parsedPdf.sections) {
        const [section] = await tx
          .insert(studySectionsTable)
          .values({
            documentId: created.id,
            title: parsedSection.title,
            sectionOrder: parsedSection.sectionOrder,
          })
          .returning();
        if (parsedSection.sentences.length > 0) {
          await tx.insert(studySentencesTable).values(parsedSection.sentences.map((sentence) => ({
            sectionId: section.id,
            subheading: sentence.subheading,
            documentOrder: sentence.documentOrder,
            text: sentence.text,
          })));
        }
      }
      await tx.delete(uploadIntentsTable).where(eq(uploadIntentsTable.objectPath, objectPath));
      return [created] as const;
    });

    res.status(201).json(ImportDocumentResponse.parse(await documentDetail(document)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to import study PDF");
    res.status(500).json({ error: "Could not save the parsed PDF." });
  }
});

router.get("/documents/:documentId", async (req: Request, res: Response): Promise<void> => {
  const ownerId = ensureUser(req, res);
  if (!ownerId) return;
  const params = GetDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const document = await getOwnedDocument(params.data.documentId, ownerId);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  res.json(await documentDetail(document));
});

router.delete("/documents/:documentId", async (req: Request, res: Response): Promise<void> => {
  const ownerId = ensureUser(req, res);
  if (!ownerId) return;
  const params = DeleteDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const document = await getOwnedDocument(params.data.documentId, ownerId);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  const file = await objectStorage.getObjectEntityFile(document.objectPath);
  await file.delete();
  await db.delete(studyDocumentsTable).where(and(
    eq(studyDocumentsTable.id, document.id),
    eq(studyDocumentsTable.ownerId, ownerId),
  ));
  res.sendStatus(204);
});

export default router;
