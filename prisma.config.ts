import { defineConfig } from "prisma/config";

const { POSTGRES_URL } = process.env;

export default defineConfig({
  schema: "./src/prisma/schema.prisma",
  migrations: {
    path: "./src/prisma/migrations",
  },
  datasource: {
    url: POSTGRES_URL,
  },
});
