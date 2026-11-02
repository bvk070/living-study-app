import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { studyDocumentsTable } from "./studyDocuments";
import { studySectionsTable } from "./studySections";
import { studySentencesTable } from "./studySentences";

export const pendingStudyCardsTable = pgTable("pending_study_cards", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull().references(() => studyDocumentsTable.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").notNull().references(() => studySectionsTable.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"flashcard" | "quiz">().notNull(),
  front: text("front").notNull(),
  answer: text("answer").notNull(),
  quizOptions: jsonb("quiz_options").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  correctAnswer: text("correct_answer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pendingCardSourcesTable = pgTable("pending_card_sources", {
  itemId: uuid("item_id").notNull().references(() => pendingStudyCardsTable.id, { onDelete: "cascade" }),
  sentenceId: uuid("sentence_id").notNull().references(() => studySentencesTable.id, { onDelete: "cascade" }),
});

export const insertPendingStudyCardSchema = createInsertSchema(pendingStudyCardsTable).omit({ id: true, createdAt: true });
export type InsertPendingStudyCard = typeof pendingStudyCardsTable.$inferInsert;
export type PendingStudyCard = typeof pendingStudyCardsTable.$inferSelect;
