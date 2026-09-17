import { getISOWeek, getISOWeekYear } from "date-fns";

/**
 * Раздел 14 ТЗ: неделя рассчитывается ТОЛЬКО от deadline, никогда от updatedAt.
 * Возвращает null, если deadline не задан (deadline может быть NULL).
 */
export function deadlineWeek(deadline: Date | null | undefined): number | null {
  if (!deadline) return null;
  return getISOWeek(deadline);
}

export function deadlineWeekYear(deadline: Date | null | undefined): number | null {
  if (!deadline) return null;
  return getISOWeekYear(deadline);
}

export function currentIsoWeek(now: Date = new Date()): { week: number; year: number } {
  return { week: getISOWeek(now), year: getISOWeekYear(now) };
}
