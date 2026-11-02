import {
  ApproveReviewItemBody,
  ApproveReviewItemParams,
  ApproveReviewItemResponse,
  DiscardReviewItemBody,
  DiscardReviewItemParams,
  DiscardReviewItemResponse,
  GetReviewQueueQueryParams,
  GetReviewQueueResponse,
} from "@workspace/api-zod";
import {
  approvedCardSourcesTable,
  approvedStudyCardsTable,
  db,
  pendingCardSourcesTable,
  pendingStudyCardsTable,
  studyDocumentsTable,
  studyReviewEventsTable,
  studySectionsTable,
  studySentencesTable,
} from "@workspace/db";
import { and, asc, count, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

function ensureUser(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.id;
}

async function ownedPendingItem(itemId: string, ownerId: string) {
  const [row] = await db
    .select({ item: pendingStudyCardsTable, document: studyDocumentsTable, section: studySectionsTable })
    .from(pendingStudyCardsTable)
    .innerJoin(studyDocumentsTable, eq(studyDocumentsTable.id, pendingStudyCardsTable.documentId))
    .innerJoin(studySectionsTable, eq(studySectionsTable.id, pendingStudyCardsTable.sectionId))
    .where(and(
      eq(pendingStudyCardsTable.id, itemId),
      eq(studyDocumentsTable.ownerId, ownerId),
    ))
    .limit(1);
  return row;
}

async function getSources(itemId: string) {
  return db
    .select({
      id: studySentencesTable.id,
      text: studySentencesTable.text,
      order: studySentencesTable.documentOrder,
    })
    .from(pendingCardSourcesTable)
    .innerJoin(studySentencesTable, eq(studySentencesTable.id, pendingCardSourcesTable.sentenceId))
    .where(eq(pendingCardSourcesTable.itemId, itemId))
    .orderBy(asc(studySentencesTable.documentOrder));
}

router.get("/review/queue", async (req: Request, res: Response): Promise<void> => {
  const ownerId = ensureUser(req, res);
  if (!ownerId) return;
  const params = GetReviewQueueQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const documentFilter = params.data.documentId
    ? eq(studyDocumentsTable.id, params.data.documentId)
    : undefined;
  if (params.data.documentId) {
    const [owned] = await db
      .select({ id: studyDocumentsTable.id })
      .from(studyDocumentsTable)
      .where(and(
        eq(studyDocumentsTable.id, params.data.documentId),
        eq(studyDocumentsTable.ownerId, ownerId),
      ))
      .limit(1);
    if (!owned) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
  }
  const baseConditions = and(eq(studyDocumentsTable.ownerId, ownerId), documentFilter);
  const [next] = await db
    .select({ item: pendingStudyCardsTable, document: studyDocumentsTable, section: studySectionsTable })
    .from(pendingStudyCardsTable)
    .innerJoin(studyDocumentsTable, eq(studyDocumentsTable.id, pendingStudyCardsTable.documentId))
    .innerJoin(studySectionsTable, eq(studySectionsTable.id, pendingStudyCardsTable.sectionId))
    .where(baseConditions)
    .orderBy(asc(pendingStudyCardsTable.createdAt))
    .limit(1);
  const [{ total: pendingCount }] = await db
    .select({ total: count() })
    .from(pendingStudyCardsTable)
    .innerJoin(studyDocumentsTable, eq(studyDocumentsTable.id, pendingStudyCardsTable.documentId))
    .where(baseConditions);
  const [{ total: reviewedCount }] = await db
    .select({ total: count() })
    .from(studyReviewEventsTable)
    .innerJoin(studyDocumentsTable, eq(studyDocumentsTable.id, studyReviewEventsTable.documentId))
    .where(baseConditions);

  let item = null;
  if (next) {
    const sources = await getSources(next.item.id);
    item = {
      id: next.item.id,
      documentId: next.document.id,
      documentName: next.document.name,
      sectionId: next.section.id,
      section: next.section.title,
      kind: next.item.kind,
      front: next.item.front,
      answer: next.item.answer,
      quizOptions: next.item.quizOptions,
      correctAnswer: next.item.correctAnswer,
      sources,
    };
  }

  res.json(GetReviewQueueResponse.parse({
    item,
    pendingCount,
    reviewedCount,
  }));
});

router.post("/review/items/:itemId/approve", async (req: Request, res: Response): Promise<void> => {
  const ownerId = ensureUser(req, res);
  if (!ownerId) return;
  const params = ApproveReviewItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = ApproveReviewItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const owned = await ownedPendingItem(params.data.itemId, ownerId);
  if (!owned) {
    res.status(404).json({ error: "Pending item not found." });
    return;
  }
  const { item, document, section } = owned;
  if (
    item.kind === "quiz" &&
    (body.data.quizOptions.length !== 4 ||
      body.data.correctAnswer === null ||
      !body.data.quizOptions.includes(body.data.correctAnswer))
  ) {
    res.status(400).json({ error: "Quiz cards need four options and one correct answer." });
    return;
  }
  if (item.kind === "flashcard" && (body.data.quizOptions.length !== 0 || body.data.correctAnswer !== null)) {
    res.status(400).json({ error: "Flashcards cannot have quiz options or a correct answer." });
    return;
  }

  const sources = await getSources(item.id);
  if (sources.length < 1 || sources.length > 2) {
    res.status(409).json({ error: "The draft does not have valid source sentences." });
    return;
  }
  const originalDraft = {
    front: item.front,
    answer: item.answer,
    quizOptions: item.quizOptions,
    correctAnswer: item.correctAnswer,
  };
  const finalDraft = {
    front: body.data.front.trim(),
    answer: body.data.answer.trim(),
    quizOptions: body.data.quizOptions.map((option) => option.trim()),
    correctAnswer: body.data.correctAnswer?.trim() ?? null,
  };
  const outcome =
    JSON.stringify(originalDraft) === JSON.stringify(finalDraft)
      ? "approved_as_is"
      : "edited";

  const [card] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(approvedStudyCardsTable)
      .values({
        sourceDraftId: item.id,
        documentId: document.id,
        sectionId: section.id,
        kind: item.kind,
        ...finalDraft,
        originalDraft,
        reviewOutcome: outcome,
      })
      .returning();
    await tx.insert(approvedCardSourcesTable).values(sources.map((source) => ({
      cardId: created.id,
      sentenceId: source.id,
    })));
    await tx.insert(studyReviewEventsTable).values({
      itemId: item.id,
      documentId: document.id,
      sectionId: section.id,
      outcome,
      reason: null,
    });
    await tx.delete(pendingStudyCardsTable).where(eq(pendingStudyCardsTable.id, item.id));
    return [created] as const;
  });

  res.json(ApproveReviewItemResponse.parse({
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
  }));
});

router.post("/review/items/:itemId/discard", async (req: Request, res: Response): Promise<void> => {
  const ownerId = ensureUser(req, res);
  if (!ownerId) return;
  const params = DiscardReviewItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = DiscardReviewItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const owned = await ownedPendingItem(params.data.itemId, ownerId);
  if (!owned) {
    res.status(404).json({ error: "Pending item not found." });
    return;
  }
  const [event] = await db.transaction(async (tx) => {
    const [record] = await tx.insert(studyReviewEventsTable).values({
      itemId: owned.item.id,
      documentId: owned.document.id,
      sectionId: owned.section.id,
      outcome: "discarded",
      reason: body.data.reason,
    }).returning();
    await tx.delete(pendingStudyCardsTable).where(eq(pendingStudyCardsTable.id, owned.item.id));
    return [record] as const;
  });
  res.json(DiscardReviewItemResponse.parse({
    id: event.id,
    outcome: event.outcome,
    reason: event.reason,
    createdAt: event.createdAt,
  }));
});

export default router;
