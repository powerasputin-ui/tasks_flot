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

/** Выбранный сегмент: "all" — все, NO_SEGMENT — без сегмента, иначе id сегмента. */
export function filterBySegment<T extends { segmentId: string | null }>(rows: T[], selected: string): T[] {
  if (selected === "all") return rows;
  if (selected === NO_SEGMENT) return rows.filter((r) => r.segmentId === null);
  return rows.filter((r) => r.segmentId === selected);
}
