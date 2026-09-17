/**
 * Импорт исходного Excel (раздел 52-53 ТЗ).
 * Запуск: npm run import:excel -- "путь/к/файлу.xlsx" [--dry-run]
 *
 * Пайплайн: Parse -> Validate -> Import -> Report.
 * После импорта Excel перестаёт быть источником истины (раздел 5) — этот скрипт
 * предназначен для первичной миграции, не для регулярного использования.
 */
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type RawRow = {
  recordType: string | null; // "Трек" | "Задача" | "Судно"
  segment: string | null;
  trackName: string | null;
  vesselName: string | null;
  cost: string | null;
  attractiveness: string | null;
  ideaOrTaskTitle: string | null;
  deadline: Date | null;
  owner: string | null;
  status: string | null;
  operRaw: string | null;
  comment: string | null;
  excelRow: number;
};

type ValidationIssue = {
  excelRow: number;
  kind:
    | "UNKNOWN_SEGMENT"
    | "UNKNOWN_STATUS"
    | "UNKNOWN_ATTRACTIVENESS"
    | "EMPTY_TRACK"
    | "INVALID_DATE"
    | "DUPLICATE_TRACK"
    | "UNKNOWN_USER"
    | "ORPHAN_ROW"; // Task/VesselOption без соответствующего Track
  detail: string;
};

function parseSheet(path: string): RawRow[] {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets["Трекер"];
  if (!ws) throw new Error('Лист "Трекер" не найден в файле.');

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    header: 1,
    range: 8, // заголовки на строке 8 (0-indexed range начинается со следующей строки данных)
    raw: false,
    defval: null,
  }) as unknown as (string | null)[][];

  const rows: RawRow[] = [];
  raw.forEach((r, idx) => {
    if (!r || r.every((v) => v === null || v === "")) return;
    const excelRow = 9 + idx; // строка 9 = первая строка данных
    const [recordType, segment, trackName, vesselName, cost, attractiveness, , ideaOrTaskTitle, deadlineRaw, owner, status, operRaw, comment] = r;

    rows.push({
      recordType: normalize(recordType),
      segment: normalize(segment),
      trackName: normalize(trackName),
      vesselName: normalize(vesselName),
      cost: normalize(cost),
      attractiveness: normalize(attractiveness),
      ideaOrTaskTitle: normalize(ideaOrTaskTitle),
      deadline: parseExcelDate(deadlineRaw),
      owner: normalize(owner),
      status: normalize(status),
      operRaw: normalize(operRaw),
      comment: normalize(comment),
      excelRow,
    });
  });
  return rows;
}

function normalize(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  return s;
}

function parseExcelDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  const filePath = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!filePath) {
    console.error('Укажите путь к файлу: npm run import:excel -- "путь/к/файлу.xlsx"');
    process.exit(1);
  }

  const rows = parseSheet(filePath);
  console.log(`Прочитано строк данных: ${rows.length}`);

  const [segments, statuses, attractiveness, users] = await Promise.all([
    prisma.segment.findMany(),
    prisma.status.findMany(),
    prisma.attractiveness.findMany(),
    prisma.user.findMany(),
  ]);

  const segmentByName = new Map(segments.map((s) => [s.name, s]));
  const statusByName = new Map(statuses.map((s) => [s.name, s]));
  const attractivenessByName = new Map(attractiveness.map((a) => [a.name, a]));
  const userByName = new Map(users.map((u) => [u.name, u]));

  const issues: ValidationIssue[] = [];
  const unknownUsers = new Set<string>();

  // --- Проход 1: создать Track из строк типа "Трек" ---
  const trackKeyToId = new Map<string, string>(); // key = `${segment}::${trackName}`
  const seenTrackKeys = new Set<string>();

  for (const row of rows) {
    if (row.recordType !== "Трек") continue;

    if (!row.trackName) {
      issues.push({ excelRow: row.excelRow, kind: "EMPTY_TRACK", detail: "Пустое название трека" });
      continue;
    }

    const key = `${row.segment ?? ""}::${row.trackName}`;
    if (seenTrackKeys.has(key)) {
      issues.push({ excelRow: row.excelRow, kind: "DUPLICATE_TRACK", detail: `Повтор трека: ${row.trackName}` });
    }
    seenTrackKeys.add(key);

    if (row.segment && !segmentByName.has(row.segment)) {
      issues.push({ excelRow: row.excelRow, kind: "UNKNOWN_SEGMENT", detail: row.segment });
    }
    if (row.status && !statusByName.has(row.status)) {
      issues.push({ excelRow: row.excelRow, kind: "UNKNOWN_STATUS", detail: row.status });
    }
    if (row.attractiveness && !attractivenessByName.has(row.attractiveness)) {
      issues.push({ excelRow: row.excelRow, kind: "UNKNOWN_ATTRACTIVENESS", detail: row.attractiveness });
    }
    if (row.owner && !userByName.has(row.owner)) {
      unknownUsers.add(row.owner);
      issues.push({ excelRow: row.excelRow, kind: "UNKNOWN_USER", detail: row.owner });
    }

    if (!dryRun) {
      const track = await prisma.track.create({
        data: {
          name: row.trackName,
          description: row.ideaOrTaskTitle,
          segmentId: row.segment ? segmentByName.get(row.segment)?.id ?? null : null,
          statusId: row.status ? statusByName.get(row.status)?.id ?? null : null,
          attractivenessId: row.attractiveness ? attractivenessByName.get(row.attractiveness)?.id ?? null : null,
          ownerId: row.owner ? userByName.get(row.owner)?.id ?? null : null,
          operFlag: row.operRaw === "да",
          // ANALYSIS.md UNRESOLVED #1: Track.deadline из Excel сознательно не переносится —
          // в модели ТЗ (раздел 11) у Track нет deadline. row.deadline здесь игнорируется.
        },
      });
      trackKeyToId.set(key, track.id);
    }
  }

  // --- Проход 2: Task и VesselOption, привязка к Track по (Segment, TrackName) ---
  let importedTasks = 0;
  let importedVessels = 0;

  for (const row of rows) {
    if (row.recordType !== "Задача" && row.recordType !== "Судно") continue;
    if (!row.trackName) {
      issues.push({ excelRow: row.excelRow, kind: "EMPTY_TRACK", detail: "Строка без названия трека-родителя" });
      continue;
    }

    const key = `${row.segment ?? ""}::${row.trackName}`;
    const trackId = trackKeyToId.get(key);
    if (!trackId && !dryRun) {
      issues.push({
        excelRow: row.excelRow,
        kind: "ORPHAN_ROW",
        detail: `Не найден родительский трек "${row.trackName}" (сегмент: ${row.segment ?? "—"})`,
      });
      continue;
    }

    if (row.status && !statusByName.has(row.status)) {
      issues.push({ excelRow: row.excelRow, kind: "UNKNOWN_STATUS", detail: row.status });
    }
    if (row.owner && !userByName.has(row.owner)) {
      unknownUsers.add(row.owner);
      issues.push({ excelRow: row.excelRow, kind: "UNKNOWN_USER", detail: row.owner });
    }

    if (row.deadline === null && row.recordType === "Задача") {
      // не ошибка (раздел 22 допускает Task без deadline), но не INVALID_DATE — пропускаем
    }

    if (dryRun) continue;

    if (row.recordType === "Задача") {
      await prisma.task.create({
        data: {
          trackId: trackId!,
          title: row.ideaOrTaskTitle ?? "(без названия)",
          deadline: row.deadline,
          statusId: row.status ? statusByName.get(row.status)?.id ?? null : null,
          ownerId: row.owner ? userByName.get(row.owner)?.id ?? null : null,
          comment: row.comment,
          operFlag: row.operRaw === "да",
        },
      });
      importedTasks++;
    } else {
      if (row.attractiveness && !attractivenessByName.has(row.attractiveness)) {
        issues.push({ excelRow: row.excelRow, kind: "UNKNOWN_ATTRACTIVENESS", detail: row.attractiveness });
      }
      await prisma.vesselOption.create({
        data: {
          trackId: trackId!,
          name: row.vesselName ?? "(без названия)",
          cost: row.cost,
          statusId: row.status ? statusByName.get(row.status)?.id ?? null : null,
          attractivenessId: row.attractiveness ? attractivenessByName.get(row.attractiveness)?.id ?? null : null,
          comment: row.comment,
        },
      });
      importedVessels++;
    }
  }

  console.log("\n=== ОТЧЁТ ИМПОРТА (раздел 52 ТЗ) ===");
  console.log(`Режим: ${dryRun ? "DRY RUN (без записи в БД)" : "ИМПОРТ ВЫПОЛНЕН"}`);
  console.log(`Треков создано: ${dryRun ? seenTrackKeys.size : trackKeyToId.size}`);
  console.log(`Задач создано: ${importedTasks}`);
  console.log(`Вариантов судов создано: ${importedVessels}`);
  console.log(`\nПредупреждений: ${issues.length}`);
  for (const issue of issues) {
    console.log(`  [строка ${issue.excelRow}] ${issue.kind}: ${issue.detail}`);
  }
  if (unknownUsers.size > 0) {
    console.log(`\nНеизвестные пользователи (${unknownUsers.size}) — ownerId оставлен NULL, раздел 38:`);
    for (const name of unknownUsers) console.log(`  - ${name}`);
    console.log("Создайте для них учётные записи в /settings, затем при необходимости обновите владельцев вручную.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
