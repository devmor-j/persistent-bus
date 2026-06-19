import "@dotenvx/dotenvx/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

const { SQLITE_PATH } = process.env;

const sqliteAbsolutePath = path.resolve(process.cwd(), SQLITE_PATH);

export default defineConfig({
  schema: "./schema.prisma",
  migrations: {
    path: "./migrations",
  },
  datasource: {
    url: `file:${sqliteAbsolutePath}`,
  },
});
