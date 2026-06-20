import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/client.ts";

function createPrisma(sqlitePath: string) {
  // TODO: should enable WAL? measure default performance first.
  // https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md
  const adapter = new PrismaBetterSqlite3({ url: sqlitePath });
  return new PrismaClient({ adapter });
}

export { Prisma } from "./generated/client.ts";
export { createPrisma };
