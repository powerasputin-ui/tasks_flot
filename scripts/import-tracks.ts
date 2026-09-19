/**
 * Загружает в справочник «Трек» строки типа "Трек" из исходного Excel
 * (лист «Трекер»): название трека и его сегмент. Задачи и суда не трогает.
 * Идемпотентен: существующие (название + сегмент) пропускаются.
 *
 * Запуск: npm run import-tracks -- "source-data/Флот-приобретение и коммерция.xlsx" [--dry-run]
 */
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry-run");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));

async function withRetry<T>(fn: () => Promise<T>, attempts = 6, delayMs = 3000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`Попытка ${i + 1}/${attempts} не удалась (соединение с БД), повтор…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

async function main() {
  if (!file) throw new Error('Укажите путь к xlsx: npm run import-tracks -- "путь/к/файлу.xlsx"');

  const ws = XLSX.readFile(file).Sheets["Трекер"];
  if (!ws) throw new Error('В файле нет листа «Трекер»');
  const rows = XLSX.utils.sheet_to_json<Record<string, string | null>>(ws, { range: 7, defval: null });
  const tracks = rows
    .filter((r) => r["Запись"] === "Трек" && typeof r["Трек"] === "string" && r["Трек"].trim())
    .map((r) => ({ name: (r["Трек"] as string).trim(), segment: typeof r["Сегмент"] === "string" ? r["Сегмент"].trim() : null }));

  const segments = await withRetry(() => prisma.segment.findMany());
  const segmentId = new Map(segments.map((s) => [s.name, s.id]));

  let created = 0;
  let skipped = 0;
  for (const [i, t] of tracks.entries()) {
    if (t.segment && !segmentId.has(t.segment)) throw new Error(`Неизвестный сегмент «${t.segment}» у трека «${t.name}»`);
    const sid = t.segment ? segmentId.get(t.segment)! : null;
    const exists = await withRetry(() => prisma.track.findFirst({ where: { name: t.name, segmentId: sid } }));
    if (exists) {
      skipped++;
      continue;
    }
    if (!DRY) await prisma.track.create({ data: { name: t.name, segmentId: sid, sortOrder: i } });
    created++;
    console.log(`${DRY ? "[dry-run] " : ""}+ ${t.segment ?? "без сегмента"} · ${t.name}`);
  }
  console.log(`\nТреков в файле: ${tracks.length}; ${DRY ? "будет добавлено" : "добавлено"}: ${created}; уже были: ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
