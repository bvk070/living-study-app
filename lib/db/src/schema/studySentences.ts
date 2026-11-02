import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { studySectionsTable } from "./studySections";

export const studySentencesTable = pgTable("study_sentences", {
  id: uuid("id").defaultRandom().primaryKey(),
  sectionId: uuid("section_id").notNull().references(() => studySectionsTable.id, { onDelete: "cascade" }),
  subheading: text("subheading"),
  documentOrder: integer("document_order").notNull(),
  text: text("text").notNull(),
});

export const insertStudySentenceSchema = createInsertSchema(studySentencesTable).omit({ id: true });
export type InsertStudySentence = typeof studySentencesTable.$inferInsert;
export type StudySentence = typeof studySentencesTable.$inferSelect;
