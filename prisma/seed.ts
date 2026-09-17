import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Раздел 8: подтверждённые значения сегментов (совпадают с исходным Excel, см. ANALYSIS.md).
const SEGMENTS = [
  "Дноуглубительный флот",
  "Крупнотоннажные перевозки",
  "Оффшорный флот",
  "Портовый флот и ледоколы",
  "Строительный флот",
  "Танкерный флот",
];

// Раздел 9.
const ATTRACTIVENESS = ["ВЫСОКАЯ", "ВЫШЕ СРЕДНЕГО", "СРЕДНЯЯ", "НИЗКАЯ"];

// Раздел 10. Цвета — оформление (не бизнес-значение), подобраны в стиле раздела 78.
const STATUSES: Array<{ name: string; color: string }> = [
  { name: "Не начато", color: "#9CA3AF" },
  { name: "В работе", color: "#2563EB" },
  { name: "Завершено", color: "#16A34A" },
  { name: "На стопе", color: "#DC2626" },
  { name: "Не актуально", color: "#A1A1AA" },
];

async function main() {
  for (const [i, name] of SEGMENTS.entries()) {
    await prisma.segment.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: i },
    });
  }

  for (const [i, name] of ATTRACTIVENESS.entries()) {
    await prisma.attractiveness.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: i },
    });
  }

  for (const [i, s] of STATUSES.entries()) {
    await prisma.status.upsert({
      where: { name: s.name },
      update: { color: s.color },
      create: { name: s.name, color: s.color, sortOrder: i },
    });
  }

  const curatorEmail = "curator@tasksflot.local";
  const existingCurator = await prisma.user.findUnique({ where: { email: curatorEmail } });
  if (!existingCurator) {
    const passwordHash = await bcrypt.hash("ChangeMe123!", 10);
    await prisma.user.create({
      data: {
        name: "Куратор (первичный)",
        email: curatorEmail,
        passwordHash,
        role: "CURATOR",
      },
    });
    console.log(`Создан стартовый пользователь-куратор: ${curatorEmail} / ChangeMe123! — смените пароль после первого входа.`);
  }

  console.log("Seed завершён: справочники Segment/Attractiveness/Status заполнены.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
