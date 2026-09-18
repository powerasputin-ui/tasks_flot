/**
 * Раздел 34 ТЗ: self-signup отсутствует, пользователей создаёт администратор.
 * Создаёт учётные записи для 14 реальных людей из колонки "Ответственный"
 * исходного Excel, которых импорт (scripts/import-excel.ts) не смог
 * сопоставить (см. ANALYSIS.md, отчёт импорта). Затем повторно проходит по
 * Excel и проставляет ownerId у уже существующих Track/Task, где он остался
 * NULL — раздел 38 ("система не должна подставлять случайного пользователя")
 * тут не нарушается: имя сопоставляется 1:1 с конкретным человеком из
 * исходных данных, это не случайное назначение.
 *
 * Запуск: npm run add-responsible-users -- "путь/к/файлу.xlsx" [--dry-run]
 */
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Транслитерация вручную — не нужно тащить библиотеку ради 14 email-слагов.
const NAME_TO_EMAIL_SLUG: Record<string, string> = {
  "Чаусов А.В.": "chausov.av",
  "Фёдоров С.В.": "fedorov.sv",
  "Сухов В.А.": "sukhov.va",
  "Давыдов Д.М.": "davydov.dm",
  "Майков Т.Г.": "maykov.tg",
  "Козлов А.С.": "kozlov.as",
  "Мсоев А.Я.": "msoev.ay",
  "Мавродиев Р.С.": "mavrodiev.rs",
  "Прасолов А.С.": "prasolov.as",
  "Молокоедов В.А.": "molokoedov.va",
  "Чуркин М.В.": "churkin.mv",
  "Стасюк К.В.": "stasyuk.kv",
  "Серегин С.Ю.": "seregin.su",
  "Смирнов В.А.": "smirnov.va",
};

const TEMP_PASSWORD = "ChangeMe123!";

type RawRow = {
  recordType: string | null;
  segment: string | null;
  trackName: string | null;
  ideaOrTaskTitle: string | null;
  owner: string | null;
  excelRow: number;
};

function normalize(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  return s;
}

function parseSheet(path: string): RawRow[] {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets["Трекер"];
  if (!ws) throw new Error('Лист "Трекер" не найден в файле.');

  const raw = XLSX.utils.sheet_to_json<(string | null)[]>(ws, {
    header: 1,
    range: 8,
    raw: false,
    defval: null,
  }) as unknown as (string | null)[][];

  const rows: RawRow[] = [];
  raw.forEach((r, idx) => {
    if (!r || r.every((v) => v === null || v === "")) return;
    const [recordType, segment, trackName, , , , , ideaOrTaskTitle, , owner] = r;
    rows.push({
      recordType: normalize(recordType),
      segment: normalize(segment),
      trackName: normalize(trackName),
      ideaOrTaskTitle: normalize(ideaOrTaskTitle),
      owner: normalize(owner),
      excelRow: 9 + idx,
    });
  });
  return rows;
}

async function main() {
  const filePath = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!filePath) {
    console.error('Укажите путь к файлу: npm run add-responsible-users -- "путь/к/файлу.xlsx"');
    process.exit(1);
  }

  // --- Шаг 1: создать учётные записи ---
  const createdUsers: string[] = [];
  const userIdByName = new Map<string, string>();

  for (const [name, slug] of Object.entries(NAME_TO_EMAIL_SLUG)) {
    const email = `${slug}@tasksflot.local`;
    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { name }] } });
    if (existing) {
      userIdByName.set(name, existing.id);
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] создал бы пользователя: ${name} <${email}>`);
      continue;
    }
    const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash, role: "RESPONSIBLE" },
    });
    userIdByName.set(name, user.id);
    createdUsers.push(`${name} <${email}>`);
  }

  console.log(`\nСоздано пользователей: ${createdUsers.length}`);
  createdUsers.forEach((u) => console.log(`  ${u} / ${TEMP_PASSWORD}`));

  if (dryRun) {
    console.log("\n[dry-run] пропускаем восстановление ownerId.");
    return;
  }

  // --- Шаг 2: восстановить ownerId у существующих Track/Task ---
  const rows = parseSheet(filePath);

  const tracks = await prisma.track.findMany({ include: { segment: true } });
  const trackByKey = new Map(tracks.map((t) => [`${t.segment?.name ?? ""}::${t.name}`, t]));

  const allTasks = await prisma.task.findMany();
  const tasksByTrack = new Map<string, typeof allTasks>();
  for (const t of allTasks) {
    const list = tasksByTrack.get(t.trackId) ?? [];
    list.push(t);
    tasksByTrack.set(t.trackId, list);
  }

  let trackOwnersSet = 0;
  let taskOwnersSet = 0;
  const consumedTaskIds = new Set<string>();

  for (const row of rows) {
    if (!row.owner || !row.trackName) continue;
    const userId = userIdByName.get(row.owner);
    if (!userId) continue; // не из нашего списка 14 — оставляем как раньше (раздел 39/38)

    const trackKey = `${row.segment ?? ""}::${row.trackName}`;
    const track = trackByKey.get(trackKey);
    if (!track) continue;

    if (row.recordType === "Трек") {
      if (!track.ownerId) {
        await prisma.track.update({ where: { id: track.id }, data: { ownerId: userId } });
        trackOwnersSet++;
      }
      continue;
    }

    if (row.recordType === "Задача") {
      const candidates = (tasksByTrack.get(track.id) ?? []).filter(
        (t) => !consumedTaskIds.has(t.id) && !t.ownerId && t.title === (row.ideaOrTaskTitle ?? "(без названия)")
      );
      const task = candidates[0];
      if (task) {
        await prisma.task.update({ where: { id: task.id }, data: { ownerId: userId } });
        consumedTaskIds.add(task.id);
        taskOwnersSet++;
      }
    }
  }

  console.log(`\nВосстановлено ownerId: Track — ${trackOwnersSet}, Task — ${taskOwnersSet}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
