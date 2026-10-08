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

export const NO_TRACK = "none";

/** Ключ выбранного в сайдбаре трека: трек внутри конкретного сегмента («Без трека» и «Без сегмента» — свои ключи). */
export const trackPickKey = (segmentId: string | null, trackId: string | null) => `${segmentId ?? NO_SEGMENT}:${trackId ?? NO_TRACK}`;

export type TrackCount = { key: string; trackId: string; name: string; total: number };

/**
 * Треки внутри каждого сегмента для раскрывающегося списка слева: только треки, где есть позиции;
 * больше позиций — выше, при равенстве по алфавиту; «Без трека» — в конце.
 */
export function countByTrack(rows: Array<{ segmentId: string | null; trackId: string | null; trackName: string | null }>): Map<string, TrackCount[]> {
  const bySegment = new Map<string, Map<string, TrackCount>>();
  for (const r of rows) {
    const seg = r.segmentId ?? NO_SEGMENT;
    const trackId = r.trackId ?? NO_TRACK;
    const tracks = bySegment.get(seg) ?? new Map<string, TrackCount>();
    const t = tracks.get(trackId) ?? { key: trackPickKey(r.segmentId, r.trackId), trackId, name: r.trackId ? r.trackName ?? "Трек" : "Без трека", total: 0 };
    t.total++;
    tracks.set(trackId, t);
    bySegment.set(seg, tracks);
  }
  const out = new Map<string, TrackCount[]>();
  for (const [seg, tracks] of bySegment) {
    out.set(
      seg,
      [...tracks.values()].sort((a, b) => Number(a.trackId === NO_TRACK) - Number(b.trackId === NO_TRACK) || b.total - a.total || a.name.localeCompare(b.name, "ru"))
    );
  }
  return out;
}

/**
 * Выбор слева: сегменты и треки внутри сегментов (можно несколько). Ничего не выбрано — все строки.
 * Строка видна, если отмечена её пара «сегмент + трек», или отмечен её сегмент и в нём не отмечено ни одного трека.
 */
export function filterBySegmentsAndTracks<T extends { segmentId: string | null; trackId: string | null }>(rows: T[], segments: string[], trackPicks: string[]): T[] {
  if (trackPicks.length === 0) return filterBySegments(rows, segments);
  const picks = new Set(trackPicks);
  const segsWithPicks = new Set(trackPicks.map((k) => k.slice(0, k.indexOf(":"))));
  const segs = new Set(segments);
  return rows.filter((r) => {
    const seg = r.segmentId ?? NO_SEGMENT;
    if (picks.has(trackPickKey(r.segmentId, r.trackId))) return true;
    return segs.has(seg) && !segsWithPicks.has(seg);
  });
}
