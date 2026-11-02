import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { studyDocumentsTable } from "./studyDocuments";
import { studySectionsTable } from "./studySections";

export const studyReviewEventsTable = pgTable("study_review_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id").notNull(),
  documentId: uuid("document_id").notNull().references(() => studyDocumentsTable.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").notNull().references(() => studySectionsTable.id, { onDelete: "cascade" }),
  outcome: text("outcome").$type<"approved_as_is" | "edited" | "discarded">().notNull(),
  reason: varchar("reason", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStudyReviewEventSchema = createInsertSchema(studyReviewEventsTable).omit({ id: true, createdAt: true });
export type InsertStudyReviewEvent = typeof studyReviewEventsTable.$inferInsert;
export type StudyReviewEvent = typeof studyReviewEventsTable.$inferSelect;
