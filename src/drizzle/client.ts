import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema/index.ts";

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function createDb(sqlitePath: string) {
  if (db) return db;

  const sqlite = new Database(sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  db = drizzle({ client: sqlite, schema });
  return db;
}
