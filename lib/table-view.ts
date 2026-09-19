import { prisma } from "@/lib/prisma";
import { deadlineWeek } from "@/lib/deadline-week";
import type { Prisma } from "@prisma/client";

/**
 * Единая модель строки таблицы (TZ_v4, раздел 3): одна позиция оперативки = одна строка.
 * Колонки интерфейса не меняются: Сегмент, Трек, Название, Оценка $, Привлекательность,
 * Ответственный, Срок, Статус, Опер, Комментарии.
 */
export type TableRow = {
  id: string;
  segmentId: string | null;
  segmentName: string | null;
  trackId: string | null;
  trackName: string | null;
  name: string; // title позиции
  cost: string | null;
  attractivenessId: string | null;
  attractivenessName: string | null;
  attractivenessColor: string | null;
  ownerId: string | null; // ответственный (человек)
  ownerName: string | null;
  deadline: Date | null;
  deadlineWeek: number | null;
  statusId: string | null;
  statusName: string | null;
  statusColor: string | null;
  operFlag: boolean;
  comment: string | null;
  version: number;
  createdByName: string;
  updatedAt: Date;
  /** Недель с последнего обновления — подсветка «давно не трогали». */
  staleWeeks: number;
  archived: boolean;
};

export type ArchiveMode = "active" | "archived" | "all";

export type TableFilters = {
  /** Несколько сегментов сразу; "none" — позиции без сегмента; пусто — все. */
  segmentIds?: string[];
  trackId?: string;
  statusId?: string;
  ownerId?: string;
  attractivenessId?: string;
  week?: number;
  deadlineFrom?: Date;
  deadlineTo?: Date;
  operFlag?: boolean;
  q?: string;
};

export type TableSort = {
  sortBy?: "deadline" | "deadlineWeek" | "status" | "attractiveness" | "owner" | "segment" | "updatedAt" | "track" | "title";
  sortDir?: "asc" | "desc";
};

function weeksSince(date: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (7 * 24 * 60 * 60 * 1000)));
}

const ITEM_INCLUDE = {
  segment: { select: { name: true } },
  track: { select: { name: true } },
  attractiveness: { select: { name: true, color: true } },
  responsible: { select: { id: true, name: true } },
  status: { select: { name: true, color: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.OperationalItemInclude;

type ItemWithRelations = Prisma.OperationalItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

export function toTableRow(i: ItemWithRelations): TableRow {
  return {
    id: i.id,
    segmentId: i.segmentId,
    segmentName: i.segment?.name ?? null,
    trackId: i.trackId,
    trackName: i.track?.name ?? null,
    name: i.title,
    cost: i.cost,
    attractivenessId: i.attractivenessId,
    attractivenessName: i.attractiveness?.name ?? null,
    attractivenessColor: i.attractiveness?.color ?? null,
    ownerId: i.responsibleId,
    ownerName: i.responsible?.name ?? null,
    deadline: i.deadline,
    deadlineWeek: deadlineWeek(i.deadline),
    statusId: i.statusId,
    statusName: i.status?.name ?? null,
    statusColor: i.status?.color ?? null,
    operFlag: i.operFlag,
    comment: i.comment,
    version: i.version,
    createdByName: i.createdBy.name,
    updatedAt: i.updatedAt,
    staleWeeks: weeksSince(i.updatedAt),
    archived: i.archivedAt !== null,
  };
}

/** Права на просмотр проверяет вызывающий маршрут (canViewItems); фильтра по отделам нет. */
export async function loadTableRows(archive: ArchiveMode = "active"): Promise<TableRow[]> {
  const items = await prisma.operationalItem.findMany({
    where: archive === "active" ? { archivedAt: null } : archive === "archived" ? { archivedAt: { not: null } } : {},
    include: ITEM_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return items.map(toTableRow);
}

export async function loadTableRow(id: string): Promise<TableRow | null> {
  const item = await prisma.operationalItem.findUnique({ where: { id }, include: ITEM_INCLUDE });
  return item ? toTableRow(item) : null;
}

export function applyTableFilters(rows: TableRow[], f: TableFilters): TableRow[] {
  const q = f.q?.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.segmentIds && f.segmentIds.length > 0 && !f.segmentIds.includes(r.segmentId ?? "none")) return false;
    if (f.trackId && r.trackId !== f.trackId) return false;
    if (f.statusId && r.statusId !== f.statusId) return false;
    if (f.ownerId && r.ownerId !== f.ownerId) return false;
    if (f.attractivenessId && r.attractivenessId !== f.attractivenessId) return false;
    if (f.week && r.deadlineWeek !== f.week) return false;
    if (f.operFlag !== undefined && r.operFlag !== f.operFlag) return false;
    if (f.deadlineFrom && (!r.deadline || r.deadline < f.deadlineFrom)) return false;
    if (f.deadlineTo && (!r.deadline || r.deadline > f.deadlineTo)) return false;
    if (q) {
      const hay = [r.name, r.comment, r.cost, r.trackName, r.segmentName, r.ownerName].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function applyTableSort(rows: TableRow[], sort: TableSort): TableRow[] {
  if (!sort.sortBy) return rows;
  const dir = sort.sortDir === "desc" ? -1 : 1;

  const key = (r: TableRow): string | number => {
    switch (sort.sortBy) {
      case "deadline":
        return r.deadline ? r.deadline.getTime() : Number.MAX_SAFE_INTEGER;
      case "deadlineWeek":
        return r.deadlineWeek ?? Number.MAX_SAFE_INTEGER;
      case "status":
        return r.statusName ?? "";
      case "attractiveness":
        return r.attractivenessName ?? "";
      case "owner":
        return r.ownerName ?? "";
      case "segment":
        return r.segmentName ?? "";
      case "track":
        return r.trackName ?? "";
      case "title":
        return r.name;
      case "updatedAt":
        return r.updatedAt.getTime();
      default:
        return "";
    }
  };

  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka < kb) return -1 * dir;
    if (ka > kb) return 1 * dir;
    return 0;
  });
}
