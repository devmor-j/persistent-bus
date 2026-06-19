import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/client.js";

const { SQLITE_PATH } = process.env;

const adapter = new PrismaBetterSqlite3({ url: SQLITE_PATH });
const prisma = new PrismaClient({ adapter });

export { Prisma } from "./generated/client.js";
export { prisma };
