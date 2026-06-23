import rawSql from "./outbox.table.sql";

export type SqlName =
  | "createTables"
  | "insert"
  | "selectRetries"
  | "selectOngoing"
  | "selectPendingRetries"
  | "updateProcessing"
  | "updateCompleted"
  | "incrementRetry"
  | "decrementRetry"
  | "updateDead"
  | "selectDeadOutboxes"
  | "deleteDeadOutboxes";

/** Parse `-- name: <key>` annotated SQL into a typed map. */
function parseSqlStatements(raw: string): Map<string, string> {
  const statements = new Map<string, string>();
  const lines = raw.split("\n");
  let currentName = "";
  const currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^--\s*name:\s*(.+)$/);
    if (match) {
      if (currentName) {
        statements.set(currentName, currentLines.join("\n").trim());
      }
      currentName = match[1].trim();
      currentLines.length = 0;
    } else {
      currentLines.push(line);
    }
  }

  if (currentName) {
    statements.set(currentName, currentLines.join("\n").trim());
  }

  return statements;
}

export const SQL = parseSqlStatements(rawSql);

export function getSql(name: SqlName): string {
  const sql = SQL.get(name);
  if (!sql) {
    throw new Error(`SQL statement "${name}" not found`);
  }
  return sql;
}
