/**
 * Какие фильтры человек держит в ряду над таблицей — личный выбор (галочки в «+ Фильтры»), хранится в учётной записи.
 * Порядок в ряду постоянный (этот список), а не порядок нажатий; ничего не выбрано — в ряду только «+ Фильтры».
 */
export const TABLE_FILTERS = ["week", "track", "status", "attractiveness", "owner", "operFlag", "deadline", "archive"] as const;
export type TableFilterKey = (typeof TABLE_FILTERS)[number];

/** Ключ настройки в app_settings: у каждого свой набор. */
export const tableFiltersKey = (userId: string) => `table.filters:${userId}`;

/** Только известные ключи, без повторов и в постоянном порядке; всё остальное (старое, испорченное) — пустой набор. */
export function normalizeShownFilters(value: unknown): TableFilterKey[] {
  if (!Array.isArray(value)) return [];
  return TABLE_FILTERS.filter((k) => value.includes(k));
}
