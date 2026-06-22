import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const outboxStatus = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "DEAD",
] as const;

export type OutboxStatus = (typeof outboxStatus)[number];

export const outbox = sqliteTable(
  "Outbox",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    createdAt: text()
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text()
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    eventName: text().notNull(),
    eventId: text().notNull().unique(),
    publishedBy: text().notNull(),
    publishedAt: text().notNull(),
    processedBy: text(),
    processedAt: text(),
    payload: text({ mode: "json" }).notNull(),
    data: text().notNull(),
    status: text().$type<OutboxStatus>().notNull().default("PENDING"),
    retries: integer().notNull().default(0),
    error: text(),
  },
  (table) => [
    index("status_created_at_idx").on(table.status, table.createdAt),
    index("published_by_status_created_at_idx").on(
      table.publishedBy,
      table.status,
      table.createdAt,
    ),
  ],
);
