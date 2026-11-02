import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { studyDocumentsTable } from "./studyDocuments";

export const studySectionsTable = pgTable("study_sections", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull().references(() => studyDocumentsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sectionOrder: integer("section_order").notNull(),
  generationStatus: text("generation_status").notNull().default("pending"),
  generatedCardCount: integer("generated_card_count").notNull().default(0),
  uncoveredSentenceCount: integer("uncovered_sentence_count").notNull().default(0),
  generationError: text("generation_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStudySectionSchema = createInsertSchema(studySectionsTable).omit({ id: true, updatedAt: true });
export type InsertStudySection = typeof studySectionsTable.$inferInsert;
export type StudySection = typeof studySectionsTable.$inferSelect;
