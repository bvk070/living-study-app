import { pgTable, text, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const uploadIntentsTable = pgTable("study_upload_intents", {
  objectPath: text("object_path").primaryKey(),
  ownerId: varchar("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  size: integer("size").notNull(),
  contentType: varchar("content_type", { length: 128 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
