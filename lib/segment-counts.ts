export const NO_SEGMENT = "none";

export type SegmentCount = { total: number; oper: number };

/**
 * Счётчики для левого списка сегментов: сколько позиций в каждом сегменте и
 * сколько из них отправлено куратору («Опер»). Ключ NO_SEGMENT — позиции без сегмента.
 */
export function countBySegment(rows: Array<{ segmentId: string | null; operFlag: boolean }>): Map<string, SegmentCount> {
  const counts = new Map<string, SegmentCount>();
  for (const r of rows) {
    const key = r.segmentId ?? NO_SEGMENT;
    const c = counts.get(key) ?? { total: 0, oper: 0 };
    c.total++;
    if (r.operFlag) c.oper++;
    counts.set(key, c);
  }
  return counts;
}

/** Выбранные сегменты (можно несколько): пусто — все; NO_SEGMENT — позиции без сегмента. */
export function filterBySegments<T extends { segmentId: string | null }>(rows: T[], selected: string[]): T[] {
  if (selected.length === 0) return rows;
  const set = new Set(selected);
  return rows.filter((r) => set.has(r.segmentId ?? NO_SEGMENT));
}

/** Переключает сегмент в выборе (добавляет, если не выбран; убирает, если выбран). */
export function toggleSegment(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

/**
 * Группы для наглядного сравнения: строки раскладываются по выбранным сегментам в порядке
 * списка слева; пустые группы пропускаются.
 */
export function groupBySegment<T extends { segmentId: string | null }>(rows: T[], order: string[]): Array<{ id: string; rows: T[] }> {
  const byId = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.segmentId ?? NO_SEGMENT;
    byId.set(key, [...(byId.get(key) ?? []), r]);
  }
  const known = [...order, NO_SEGMENT];
  const rest = [...byId.keys()].filter((k) => !known.includes(k));
  return [...known, ...rest].filter((id) => byId.has(id)).map((id) => ({ id, rows: byId.get(id)! }));
}
