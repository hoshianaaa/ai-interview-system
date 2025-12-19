import dotenv from "dotenv";
import path from "node:path";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.join(process.cwd(), ".env") });
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in runtime environment.");
}

const databaseUrl = process.env.DATABASE_URL ?? "";

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaNeon({ connectionString: databaseUrl }),
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
