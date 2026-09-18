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

/**
 * Раздел 9. Финальная схема по запросу заказчика: P100 высокая (зелёный),
 * P70 выше среднего (оранжевый), P50 средняя (жёлтый), P10 низкая (красный),
 * P0 отсутствует (серый) — настоящая запись справочника (управляется в
 * Настройках, выбирается как обычная потребность), см. ANALYSIS.md.
 *
 * Разовая миграция имён (ВЫСОКАЯ/ВЫШЕ СРЕДНЕГО/... -> P100/P60/P10/P0 ->
 * финальные P100/P70/P50/P10/P0) уже выполнена и удалена из этого файла —
 * держать переименование "по lookupName" здесь опасно: при повторном запуске
 * lookupName одной записи начинает совпадать с уже финальным именем другой
 * и ломает данные. Ниже — обычный идемпотентный upsert по финальному имени.
 */
const ATTRACTIVENESS: Array<{ name: string; color: string }> = [
  { name: "P100", color: "#16A34A" }, // высокая — зелёный
  { name: "P70", color: "#F97316" }, // выше среднего — оранжевый
  { name: "P50", color: "#EAB308" }, // средняя — жёлтый
  { name: "P10", color: "#DC2626" }, // низкая — красный
  { name: "P0", color: "#9CA3AF" }, // отсутствует — серый
];

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

  for (const [i, a] of ATTRACTIVENESS.entries()) {
    await prisma.attractiveness.upsert({
      where: { name: a.name },
      update: { color: a.color, sortOrder: i },
      create: { name: a.name, color: a.color, sortOrder: i },
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

async function withRetry<T>(fn: () => Promise<T>, attempts = 5, delayMs = 2000): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      console.log(`Попытка ${i + 1}/${attempts} не удалась (вероятно, обрыв соединения с Neon), повтор через ${delayMs}мс…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

withRetry(() => prisma.$connect().then(main))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
