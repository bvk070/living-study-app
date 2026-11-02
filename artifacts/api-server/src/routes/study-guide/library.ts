import {
  GetReviewStatsQueryParams,
  GetReviewStatsResponse,
  ListApprovedCardsQueryParams,
  ListApprovedCardsResponse,
} from "@workspace/api-zod";
import {
  approvedCardSourcesTable,
  approvedStudyCardsTable,
  db,
  studyDocumentsTable,
  studyReviewEventsTable,
  studySectionsTable,
  studySentencesTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

function ensureUser(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

async function verifyFilters(ownerId: string, documentId?: string, sectionId?: string) {
  if (documentId) {
    const [document] = await db
      .select({ id: studyDocumentsTable.id })
      .from(studyDocumentsTable)
      .where(and(
        eq(studyDocumentsTable.id, documentId),
        eq(studyDocumentsTable.ownerId, ownerId),
      ))
      .limit(1);
    if (!document) return false;
  }
  if (sectionId) {
    const [section] = await db
      .select({ id: studySectionsTable.id })
      .from(studySectionsTable)
      .innerJoin(studyDocumentsTable, eq(studyDocumentsTable.id, studySectionsTable.documentId))
      .where(and(
        eq(studySectionsTable.id, sectionId),
        eq(studyDocumentsTable.ownerId, ownerId),
        documentId ? eq(studySectionsTable.documentId, documentId) : undefined,
      ))
      .limit(1);
    if (!section) return false;
  }
  return true;
}

router.get("/library", async (req: Request, res: Response): Promise<void> => {
  const ownerId = ensureUser(req, res);
  if (!ownerId) return;
  const params = ListApprovedCardsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { documentId, sectionId, kind } = params.data;
  if (!(await verifyFilters(ownerId, documentId, sectionId))) {
    res.status(404).json({ error: "Document or section not found." });
    return;
  }
  const cards = await db
    .select({
      card: approvedStudyCardsTable,
      document: studyDocumentsTable,
      section: studySectionsTable,
    })
    .from(approvedStudyCardsTable)
    .innerJoin(studyDocumentsTable, eq(studyDocumentsTable.id, approvedStudyCardsTable.documentId))
    .innerJoin(studySectionsTable, eq(studySectionsTable.id, approvedStudyCardsTable.sectionId))
    .where(and(
      eq(studyDocumentsTable.ownerId, ownerId),
      documentId ? eq(approvedStudyCardsTable.documentId, documentId) : undefined,
      sectionId ? eq(approvedStudyCardsTable.sectionId, sectionId) : undefined,
      kind ? eq(approvedStudyCardsTable.kind, kind) : undefined,
    ))
    .orderBy(asc(approvedStudyCardsTable.approvedAt));

  const result = [];
  for (const { card, document, section } of cards) {
    const sources = await db
      .select({
        id: studySentencesTable.id,
        text: studySentencesTable.text,
        order: studySentencesTable.documentOrder,
      })
      .from(approvedCardSourcesTable)
      .innerJoin(studySentencesTable, eq(studySentencesTable.id, approvedCardSourcesTable.sentenceId))
      .where(eq(approvedCardSourcesTable.cardId, card.id))
      .orderBy(asc(studySentencesTable.documentOrder));
    result.push({
      id: card.id,
      documentId: document.id,
      documentName: document.name,
      sectionId: section.id,
      section: section.title,
      kind: card.kind,
      front: card.front,
      answer: card.answer,
      quizOptions: card.quizOptions,
      correctAnswer: card.correctAnswer,
      originalDraft: card.originalDraft,
      sources,
      reviewOutcome: card.reviewOutcome,
      approvedAt: card.approvedAt,
    });
  }
  res.json(ListApprovedCardsResponse.parse(result));
});

router.get("/stats", async (req: Request, res: Response): Promise<void> => {
  const ownerId = ensureUser(req, res);
  if (!ownerId) return;
  const params = GetReviewStatsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { documentId, sectionId } = params.data;
  if (!(await verifyFilters(ownerId, documentId, sectionId))) {
    res.status(404).json({ error: "Document or section not found." });
    return;
  }
  const filters = and(
    eq(studyDocumentsTable.ownerId, ownerId),
    documentId ? eq(studyReviewEventsTable.documentId, documentId) : undefined,
    sectionId ? eq(studyReviewEventsTable.sectionId, sectionId) : undefined,
  );
  const events = await db
    .select({
      outcome: studyReviewEventsTable.outcome,
      reason: studyReviewEventsTable.reason,
    })
    .from(studyReviewEventsTable)
    .innerJoin(studyDocumentsTable, eq(studyDocumentsTable.id, studyReviewEventsTable.documentId))
    .where(filters);
  const comparisons = await db
    .select({
      cardId: approvedStudyCardsTable.id,
      documentId: approvedStudyCardsTable.documentId,
      sectionId: approvedStudyCardsTable.sectionId,
      originalDraft: approvedStudyCardsTable.originalDraft,
      finalCard: approvedStudyCardsTable,
    })
    .from(approvedStudyCardsTable)
    .innerJoin(studyDocumentsTable, eq(studyDocumentsTable.id, approvedStudyCardsTable.documentId))
    .where(and(
      eq(studyDocumentsTable.ownerId, ownerId),
      eq(approvedStudyCardsTable.reviewOutcome, "edited"),
      documentId ? eq(approvedStudyCardsTable.documentId, documentId) : undefined,
      sectionId ? eq(approvedStudyCardsTable.sectionId, sectionId) : undefined,
    ));

  const reasons: Record<string, number> = {};
  for (const event of events) {
    if (event.outcome === "discarded" && event.reason) {
      reasons[event.reason] = (reasons[event.reason] ?? 0) + 1;
    }
  }

  res.json(GetReviewStatsResponse.parse({
    approvedAsIs: events.filter((event) => event.outcome === "approved_as_is").length,
    edited: events.filter((event) => event.outcome === "edited").length,
    discarded: events.filter((event) => event.outcome === "discarded").length,
    comparisons: comparisons.map(({ cardId, documentId, sectionId, originalDraft, finalCard }) => ({
      cardId,
      documentId,
      sectionId,
      originalDraft,
      finalCard: {
        front: finalCard.front,
        answer: finalCard.answer,
        quizOptions: finalCard.quizOptions,
        correctAnswer: finalCard.correctAnswer,
      },
    })),
    reasons,
  }));
});

export default router;
