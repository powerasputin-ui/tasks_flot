import {
  startOfISOWeek,
  endOfISOWeek,
  startOfMonth,
  endOfMonth,
  subMilliseconds,
  differenceInCalendarDays,
  getISOWeek,
  getISOWeekYear,
  format,
} from "date-fns";
import { ru } from "date-fns/locale";
import { loadRowsAsOf, type HistoricalRow } from "@/lib/time-travel";

/**
 * Change Engine (раздел 31 ТЗ, Phase 6). Требование заказчика: расчёт опирается
 * на календарь — знает дату и число дней в месяце, корректно считает недели.
 * Поэтому границы периода берутся из календаря (ISO-неделя пн-вс, календарный
 * месяц любой длины, включая февраль високосного года), а не "7/30 дней назад".
 *
 * Изменения = разница двух состояний (Time Travel, раздел 30): на конец
 * предыдущего периода и на конец выбранного.
 */
export type PeriodKind = "week" | "month";

export type Period = {
  kind: PeriodKind;
  start: Date;
  end: Date;
  previousEnd: Date;
  days: number;
  label: string;
};

export function periodBounds(kind: PeriodKind, anchor: Date): Period {
  const start = kind === "week" ? startOfISOWeek(anchor) : startOfMonth(anchor);
  const end = kind === "week" ? endOfISOWeek(anchor) : endOfMonth(anchor);
  const days = differenceInCalendarDays(end, start) + 1;
  const label =
    kind === "week"
      ? `Неделя ${getISOWeek(anchor)} (${getISOWeekYear(anchor)}): ${format(start, "dd.MM.yyyy")} — ${format(end, "dd.MM.yyyy")}`
      : `${format(start, "LLLL yyyy", { locale: ru })}`;
  return { kind, start, end, previousEnd: subMilliseconds(start, 1), days, label };
}

const FIELDS: Array<{ key: keyof HistoricalRow; label: string }> = [
  { key: "name", label: "Название" },
  { key: "segmentName", label: "Сегмент" },
  { key: "trackName", label: "Трек" },
  { key: "statusName", label: "Статус" },
  { key: "attractivenessName", label: "Привлекательность" },
  { key: "ownerName", label: "Ответственный" },
  { key: "deadline", label: "Срок" },
  { key: "operFlag", label: "Опер" },
  { key: "cost", label: "Оценка" },
  { key: "comment", label: "Комментарий" },
];

export type FieldChange = { field: string; before: string | null; after: string | null };
export type ChangedRecord = { row: HistoricalRow; changes: FieldChange[] };
export type ChangeSet = { added: HistoricalRow[]; removed: HistoricalRow[]; changed: ChangedRecord[] };

const show = (key: keyof HistoricalRow, v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (key === "deadline") return new Date(v as string).toLocaleDateString("ru-RU");
  if (key === "operFlag") return v ? "да" : "нет";
  return String(v);
};

export function diffStates(before: HistoricalRow[], after: HistoricalRow[]): ChangeSet {
  const keyOf = (r: HistoricalRow) => `${r.type}:${r.id}`;
  const beforeMap = new Map(before.map((r) => [keyOf(r), r]));
  const afterMap = new Map(after.map((r) => [keyOf(r), r]));

  const added = after.filter((r) => !beforeMap.has(keyOf(r)));
  const removed = before.filter((r) => !afterMap.has(keyOf(r)));
  const changed: ChangedRecord[] = [];

  for (const row of after) {
    const prev = beforeMap.get(keyOf(row));
    if (!prev) continue;
    const changes: FieldChange[] = [];
    for (const f of FIELDS) {
      const b = show(f.key, prev[f.key]);
      const a = show(f.key, row[f.key]);
      if (b !== a) changes.push({ field: f.label, before: b, after: a });
    }
    if (changes.length > 0) changed.push({ row, changes });
  }
  return { added, removed, changed };
}

export async function computeChanges(kind: PeriodKind, anchor: Date) {
  const period = periodBounds(kind, anchor);
  const [before, after] = await Promise.all([loadRowsAsOf(period.previousEnd), loadRowsAsOf(period.end)]);
  return { period, journalEmptyBefore: before.length === 0, ...diffStates(before, after) };
}
