import { DatabaseSync } from "node:sqlite";
import { getSql } from "./sql/statements.ts";

let db: DatabaseSync | undefined;

export function createSqliteDb(sqlitePath: string): DatabaseSync {
  if (db) return db;

  db = new DatabaseSync(sqlitePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(getSql("createTables"));
  return db;
}
