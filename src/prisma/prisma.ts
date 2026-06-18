import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.js";

const { POSTGRES_URL } = process.env;

const adapter = new PrismaPg({ connectionString: POSTGRES_URL });
const prisma = new PrismaClient({ adapter });

export { Prisma } from "./generated/client.js";
export { prisma };
