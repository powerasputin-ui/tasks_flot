import { PROTECTED_STATUSES } from "@/lib/statuses";

/** «Сегодня» по Москве — полночь UTC (сроки хранятся датой без времени). */
export function mskToday(now: Date = new Date()): number {
  const m = new Date(now.getTime() + 3 * 3600 * 1000);
  return Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate());
}

const dayOf = (d: Date | string) => {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
};

/**
 * Просрочено — одно правило для таблицы, аналитики, отчёта (и то же, что у ИИ и трекера): день срока по Москве уже
 * прошёл (в сам день срока — ещё нет), позиция не удалена и не закрыта — ни по названию статуса («Завершено»,
 * «Не актуально»), ни по колонке трекера («Выполнено», «Не показывать»).
 */
export function isOverdueRow(r: { deadline: Date | string | null; statusName?: string | null; statusColumn?: string | null; archived?: boolean }, now: Date = new Date()): boolean {
  if (!r.deadline || r.archived) return false;
  if (r.statusName && PROTECTED_STATUSES.includes(r.statusName)) return false;
  if (r.statusColumn === "DONE" || r.statusColumn === "HIDDEN") return false;
  return dayOf(r.deadline) < mskToday(now);
}
