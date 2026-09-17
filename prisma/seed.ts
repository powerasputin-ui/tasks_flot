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

// Раздел 10.
const STATUSES = ["Не начато", "В работе", "Завершено", "На стопе", "Не актуально"];

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

  for (const [i, name] of STATUSES.entries()) {
    await prisma.status.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: i },
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
