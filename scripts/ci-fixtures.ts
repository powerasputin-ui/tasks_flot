/**
 * Минимальные люди для автопроверки на чистой базе (GitHub Actions): e2e-набор API берёт «настоящего» куратора
 * (админа дирекции) и руководителя этой дирекции, остальное создаёт сам. Запускать ТОЛЬКО на временной базе —
 * скрипт откажется работать, если адрес базы не локальный.
 * Запуск: npx tsx scripts/ci-fixtures.ts (после prisma migrate deploy и npm run db:seed).
 */
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1|postgres)(:\d+)?\//.test(url)) {
  console.error("ci-fixtures: база не локальная — отказ (скрипт только для временной базы автопроверки).");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const dir = await prisma.directorate.findFirstOrThrow({ where: { id: "dir_fleet" } });
  const people = [
    { email: "ci-curator@ci.local", name: "Сидоров (CI) Куратор", role: "ADMIN" as const },
    { email: "ci-head@ci.local", name: "Петров (CI) Руководитель", role: "HEAD" as const },
  ];
  for (const p of people) {
    await prisma.user.upsert({ where: { email: p.email }, update: { name: p.name }, create: { ...p, passwordHash: "x", directorateId: dir.id } });
  }
  console.log("ci-fixtures: куратор и руководитель дирекции созданы.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
