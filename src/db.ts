import { DatabaseSync } from "node:sqlite";

let db: DatabaseSync | undefined;

export function createSqliteDb(sqlitePath: string): DatabaseSync {
  if (db) return db;

  db = new DatabaseSync(sqlitePath);
  db.exec("PRAGMA journal_mode = WAL");
  createTables(db);
  return db;
}

function createTables(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS Outbox (
      id TEXT PRIMARY KEY NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      eventName TEXT NOT NULL,
      eventId TEXT NOT NULL UNIQUE,
      publishedBy TEXT NOT NULL,
      publishedAt TEXT NOT NULL,
      processedBy TEXT,
      processedAt TEXT,
      payload TEXT NOT NULL,
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','COMPLETED','DEAD')),
      retries INTEGER NOT NULL DEFAULT 0,
      error TEXT
    )
  `);

  database.exec(
    "CREATE INDEX IF NOT EXISTS status_created_at_idx ON Outbox(status, createdAt)",
  );

  database.exec(
    "CREATE INDEX IF NOT EXISTS published_by_status_created_at_idx ON Outbox(publishedBy, status, createdAt)",
  );
}
