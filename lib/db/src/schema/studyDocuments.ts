import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const studyDocumentsTable = pgTable("study_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: varchar("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  objectPath: text("object_path").notNull(),
  pageCount: integer("page_count").notNull().default(0),
  status: varchar("status", { length: 24 }).notNull().default("parsing"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStudyDocumentSchema = createInsertSchema(studyDocumentsTable).omit({ id: true, createdAt: true });
export type InsertStudyDocument = typeof studyDocumentsTable.$inferInsert;
export type StudyDocument = typeof studyDocumentsTable.$inferSelect;
