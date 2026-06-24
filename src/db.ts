import { DatabaseSync } from "node:sqlite";
import { getSql } from "./sql/statements.ts";

const dbs = new Map<string, DatabaseSync>();

export function createSqliteDb(sqlitePath: string): DatabaseSync {
  const existing = dbs.get(sqlitePath);
  if (existing) return existing;

  const db = new DatabaseSync(sqlitePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(getSql("createTables"));
  dbs.set(sqlitePath, db);
  return db;
}
