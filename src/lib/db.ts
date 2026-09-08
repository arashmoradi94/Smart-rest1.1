import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const url = process.env.DATABASE_URL
    ?? (process.env.NODE_ENV !== "production" || isBuild ? "file:./dev.db" : undefined);
  if (!url) throw new Error("DATABASE_URL is required in production");
  const adapter = new PrismaLibSql({
    url,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
