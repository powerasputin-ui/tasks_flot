import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";
import type { ColumnDef } from "@/lib/custom-columns";

/**
 * Справочники (сегменты, треки, статусы, привлекательность, люди) редко меняются, а каждый запрос к удалённой базе
 * стоит около секунды. Поэтому имена для строк таблицы берём из этого кэша в памяти (один запрос на всех раз в минуту),
 * а не подтягиваем «join»-ами при каждой загрузке. Любое изменение справочника вызывает invalidateDicts().
 */
export type Dicts = {
  segments: Map<string, { name: string; color: string | null; directorateId: string | null }>;
  tracks: Map<string, { name: string; directorateId: string | null }>;
  attractiveness: Map<string, { name: string; color: string | null }>;
  statuses: Map<string, { name: string; color: string | null }>;
  users: Map<string, { id: string; name: string; role: UserRole; directorateId: string | null }>;
  /** Активные свои колонки таблицы (для проверки значений при сохранении позиции). */
  customColumns: Array<ColumnDef & { directorateId: string | null }>;
};

const TTL_MS = 60_000;
let cache: { at: number; value: Dicts } | null = null;
let inflight: Promise<Dicts> | null = null;

async function load(): Promise<Dicts> {
  // независимые запросы идут параллельно — по времени это один обмен с базой
  const [segments, tracks, attractiveness, statuses, users, customColumns] = await Promise.all([
    prisma.segment.findMany({ select: { id: true, name: true, color: true, directorateId: true } }),
    prisma.track.findMany({ select: { id: true, name: true, directorateId: true } }),
    prisma.attractiveness.findMany({ select: { id: true, name: true, color: true } }),
    prisma.status.findMany({ select: { id: true, name: true, color: true } }),
    prisma.user.findMany({ select: { id: true, name: true, role: true, directorateId: true } }),
    prisma.customColumn.findMany({ where: { isActive: true }, select: { id: true, name: true, type: true, options: true, directorateId: true } }),
  ]);
  return {
    segments: new Map(segments.map((s) => [s.id, { name: s.name, color: s.color, directorateId: s.directorateId }])),
    tracks: new Map(tracks.map((t) => [t.id, { name: t.name, directorateId: t.directorateId }])),
    attractiveness: new Map(attractiveness.map((a) => [a.id, { name: a.name, color: a.color }])),
    statuses: new Map(statuses.map((s) => [s.id, { name: s.name, color: s.color }])),
    users: new Map(users.map((u) => [u.id, u])),
    customColumns: customColumns.map((c) => ({ id: c.id, name: c.name, type: c.type, options: c.options, directorateId: c.directorateId })),
  };
}

export async function getDicts(): Promise<Dicts> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (!inflight) {
    inflight = load()
      .then((value) => {
        cache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Вызывать после любого изменения сегментов, треков, статусов, привлекательности и пользователей. */
export function invalidateDicts(): void {
  cache = null;
}
