import "@dotenvx/dotenvx/config";
import { defineConfig } from "prisma/config";

const { POSTGRES_URL } = process.env;

export default defineConfig({
  schema: "./schema.prisma",
  migrations: {
    path: "./migrations",
  },
  datasource: {
    url: POSTGRES_URL,
  },
});
