import { prisma } from "@/lib/prisma";
import { deadlineWeek } from "@/lib/deadline-week";
import { idsChangedAfterSubmission } from "@/lib/submission";
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
  /** Роль ответственного: у куратора в таблице ставится метка «К». */
  ownerRole: string | null;
  deadline: Date | null;
  deadlineWeek: number | null;
  statusId: string | null;
  statusName: string | null;
  statusColor: string | null;
  operFlag: boolean;
  comment: string | null;
  version: number;
  createdById: string;
  /** Отправлена куратору, а после отправки её правили. */
  changedAfterSubmission: boolean;
  /** Значения своих колонок: { <id колонки>: значение }. */
  customValues: Record<string, string>;
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
  /** Несколько значений сразу (ИЛИ внутри одного фильтра, И между фильтрами); пусто — без ограничения. */
  trackIds?: string[];
  statusIds?: string[];
  ownerIds?: string[];
  attractivenessIds?: string[];
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
  responsible: { select: { id: true, name: true, role: true } },
  status: { select: { name: true, color: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.OperationalItemInclude;

type ItemWithRelations = Prisma.OperationalItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

export function toTableRow(i: ItemWithRelations, changedAfterSubmission = false): TableRow {
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
    ownerRole: i.responsible?.role ?? null,
    deadline: i.deadline,
    deadlineWeek: deadlineWeek(i.deadline),
    statusId: i.statusId,
    statusName: i.status?.name ?? null,
    statusColor: i.status?.color ?? null,
    operFlag: i.operFlag,
    comment: i.comment,
    version: i.version,
    createdById: i.createdById,
    changedAfterSubmission,
    customValues: (i.customValues ?? {}) as Record<string, string>,
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
  const changed = await changedAfterSubmissionIds(items.filter((i) => i.operFlag).map((i) => i.id));
  return items.map((i) => toTableRow(i, changed.has(i.id)));
}

/** Какие из отправленных позиций правили после отправки (по журналу изменений). */
async function changedAfterSubmissionIds(sentIds: string[]): Promise<Set<string>> {
  if (sentIds.length === 0) return new Set();
  const events = await prisma.auditEvent.findMany({
    where: { entityType: "OperationalItem", entityId: { in: sentIds }, OR: [{ fieldName: "operFlag", after: "true" }, { afterSubmission: true }] },
    select: { entityId: true, fieldName: true, after: true, afterSubmission: true, timestamp: true },
  });
  return idsChangedAfterSubmission(events);
}

export async function loadTableRow(id: string): Promise<TableRow | null> {
  const item = await prisma.operationalItem.findUnique({ where: { id }, include: ITEM_INCLUDE });
  if (!item) return null;
  const changed = item.operFlag ? await changedAfterSubmissionIds([id]) : new Set<string>();
  return toTableRow(item, changed.has(id));
}

export function applyTableFilters(rows: TableRow[], f: TableFilters): TableRow[] {
  const q = f.q?.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.segmentIds && f.segmentIds.length > 0 && !f.segmentIds.includes(r.segmentId ?? "none")) return false;
    if (f.trackIds?.length && !f.trackIds.includes(r.trackId ?? "")) return false;
    if (f.statusIds?.length && !f.statusIds.includes(r.statusId ?? "")) return false;
    if (f.ownerIds?.length && !f.ownerIds.includes(r.ownerId ?? "")) return false;
    if (f.attractivenessIds?.length && !f.attractivenessIds.includes(r.attractivenessId ?? "")) return false;
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

  // null — значение не задано: такие строки всегда идут в конец, в любом направлении.
  const key = (r: TableRow): string | number | null => {
    switch (sort.sortBy) {
      case "deadline":
        return r.deadline ? r.deadline.getTime() : null;
      case "deadlineWeek":
        return r.deadlineWeek ?? null;
      case "status":
        return r.statusName ?? "";
      case "attractiveness": {
        // Шкала P100 / P70 / P50 / P10 / P0 сортируется по числу, а не как текст.
        const m = /^P(\d+)$/i.exec(r.attractivenessName ?? "");
        return m ? Number(m[1]) : r.attractivenessName ? -1 : null;
      }
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
    if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
    if (ka < kb) return -1 * dir;
    if (ka > kb) return 1 * dir;
    return 0;
  });
}
