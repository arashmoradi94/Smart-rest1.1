import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaLibSql({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  }),
});

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed is disabled in production");
  }
  const seedPassword = process.env.SEED_DEFAULT_PASSWORD;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!seedPassword || !adminPassword) {
    throw new Error("SEED_ADMIN_PASSWORD and SEED_DEFAULT_PASSWORD are required for seeding");
  }
  const users = [
    { name: "مدیر سیستم", username: "admin", password: adminPassword, role: "ADMIN" },
    { name: "امیر رضا دیانت پی", username: "amirreza", password: seedPassword, role: "EMPLOYEE" },
    { name: "مهدی علیمردانی", username: "mahdi", password: seedPassword, role: "EMPLOYEE" },
    { name: " آرش مرادی ", username: "arash", password: seedPassword, role: "EMPLOYEE" },
    { name: "تستی 1", username: "test1", password: seedPassword, role: "EMPLOYEE" },
    { name: "تستی 2", username: "test2", password: seedPassword, role: "EMPLOYEE" },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      create: {
        name: u.name,
        username: u.username,
        passwordHash: await bcrypt.hash(u.password, 10),
        role: u.role,
      },
      update: {
        passwordHash: await bcrypt.hash(u.password, 10),
        name: u.name,
        role: u.role,
      },
    });
  }
  await prisma.settings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      workDurationMinutes: 60,
      breakDurationMinutes: 10,
      maxConcurrentBreaks: 5,
      earlyNotificationMinutes: 2,
      endNotificationMinutes: 2,
    },
    update: {},
  });
}

main()
  .then(() => {
    console.log("Seed completed.");
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
