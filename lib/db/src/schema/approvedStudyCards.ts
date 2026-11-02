import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { studyDocumentsTable } from "./studyDocuments";
import { studySectionsTable } from "./studySections";
import { studySentencesTable } from "./studySentences";

export interface DraftSnapshot {
  front: string;
  answer: string;
  quizOptions: string[];
  correctAnswer: string | null;
}

export const approvedStudyCardsTable = pgTable("approved_study_cards", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceDraftId: uuid("source_draft_id").notNull().unique(),
  documentId: uuid("document_id").notNull().references(() => studyDocumentsTable.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").notNull().references(() => studySectionsTable.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"flashcard" | "quiz">().notNull(),
  front: text("front").notNull(),
  answer: text("answer").notNull(),
  quizOptions: jsonb("quiz_options").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  correctAnswer: text("correct_answer"),
  originalDraft: jsonb("original_draft").$type<DraftSnapshot>().notNull(),
  reviewOutcome: text("review_outcome").$type<"approved_as_is" | "edited">().notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const approvedCardSourcesTable = pgTable("approved_card_sources", {
  cardId: uuid("card_id").notNull().references(() => approvedStudyCardsTable.id, { onDelete: "cascade" }),
  sentenceId: uuid("sentence_id").notNull().references(() => studySentencesTable.id, { onDelete: "cascade" }),
});

export const insertApprovedStudyCardSchema = createInsertSchema(approvedStudyCardsTable).omit({ id: true, approvedAt: true });
export type InsertApprovedStudyCard = typeof approvedStudyCardsTable.$inferInsert;
export type ApprovedStudyCard = typeof approvedStudyCardsTable.$inferSelect;
