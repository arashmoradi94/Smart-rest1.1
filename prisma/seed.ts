import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  }),
});

const users = [
  { name: "مدیر سیستم", username: "admin", password: "admin1234", role: "ADMIN" },
  { name: "علی رضایی", username: "ali", password: "ali1234", role: "EMPLOYEE" },
  { name: "محمد احمدی", username: "mohammad", password: "mohammad1234", role: "EMPLOYEE" },
  { name: "رضا کریمی", username: "reza", password: "reza1234", role: "EMPLOYEE" },
  { name: "سارا موسوی", username: "sara", password: "sara1234", role: "EMPLOYEE" },
  { name: "نیما حسینی", username: "nima", password: "nima1234", role: "EMPLOYEE" },
];

async function main() {
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
