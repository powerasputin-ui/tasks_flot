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

/**
 * Неделя по московскому времени, «год-неделя». Считаем по UTC-полям сдвинутой даты, а не через часовой пояс процесса:
 * сервер на Vercel живёт в UTC, компьютер разработчика — в МСК, а ответ должен быть одинаковым.
 */
export function mskIsoWeek(d: Date): string {
  const msk = new Date(d.getTime() + 3 * 3600 * 1000);
  const day = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate());
  const dow = (new Date(day).getUTCDay() + 6) % 7; // понедельник = 0
  const thursday = new Date(day + (3 - dow) * 86400000); // ISO-неделя принадлежит году своего четверга
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * 86400000)) + 1;
  return `${year}-${week}`;
}
