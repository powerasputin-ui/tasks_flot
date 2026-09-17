import { prisma } from "@/lib/prisma";
import { deadlineWeek } from "@/lib/deadline-week";

/**
 * Единая модель для Table View (раздел 40) — и в будущем для Kanban/Timeline
 * (раздел 107-108): один и тот же набор строк, без отдельного хранения под каждое
 * представление. Строка = Track ИЛИ Task ИЛИ VesselOption, сплющенные в общую форму,
 * как в исходном Excel (раздел 5: "Запись" = Трек/Задача/Судно).
 */
export type RecordType = "TRACK" | "TASK" | "VESSEL_OPTION";

export type TableRow = {
  id: string;
  type: RecordType;
  segmentId: string | null;
  segmentName: string | null;
  trackId: string;
  trackName: string;
  name: string; // Название (для Track/VesselOption) или title (для Task)
  attractivenessId: string | null;
  attractivenessName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  deadline: Date | null;
  deadlineWeek: number | null;
  statusId: string | null;
  statusName: string | null;
  statusColor: string | null;
  operFlag: boolean;
  comment: string | null;
  cost: string | null; // раздел 16, только VesselOption
  /**
   * "Дата" по формулировке заказчика — факт последнего заполнения/обновления
   * записи. Это НЕ бизнес-поле в схеме, а прямое отображение updatedAt
   * (раздел 74: оно уже есть у каждой сущности). Не путать с deadline/
   * deadlineWeek — те по-прежнему считаются только от deadline (раздел 14).
   */
  updatedAt: Date;
  /** Недель прошло с updatedAt — для визуальной подсветки "давно не трогали". */
  staleWeeks: number;
};

export type TableFilters = {
  segmentId?: string;
  trackId?: string;
  type?: RecordType;
  statusId?: string;
  ownerId?: string;
  attractivenessId?: string;
  week?: number;
  deadlineFrom?: Date;
  deadlineTo?: Date;
  operFlag?: boolean;
};

export type TableSort = {
  sortBy?: "deadline" | "deadlineWeek" | "status" | "attractiveness" | "owner" | "segment" | "updatedAt" | "track";
  sortDir?: "asc" | "desc";
};

function weeksSince(date: Date, now: Date = new Date()): number {
  const ms = now.getTime() - date.getTime();
  return Math.max(0, Math.floor(ms / (7 * 24 * 60 * 60 * 1000)));
}

export async function loadTableRows(): Promise<TableRow[]> {
  const [tracks, tasks, vesselOptions] = await Promise.all([
    prisma.track.findMany({
      where: { archivedAt: null },
      include: { segment: true, status: true, attractiveness: true, owner: true },
    }),
    prisma.task.findMany({
      where: { archivedAt: null },
      include: {
        status: true,
        owner: true,
        track: { include: { segment: true } },
      },
    }),
    prisma.vesselOption.findMany({
      where: { archivedAt: null },
      include: {
        status: true,
        attractiveness: true,
        track: { include: { segment: true } },
      },
    }),
  ]);

  const trackRows: TableRow[] = tracks.map((t) => ({
    id: t.id,
    type: "TRACK",
    segmentId: t.segmentId,
    segmentName: t.segment?.name ?? null,
    trackId: t.id,
    trackName: t.name,
    name: t.name,
    attractivenessId: t.attractivenessId,
    attractivenessName: t.attractiveness?.name ?? null,
    ownerId: t.ownerId,
    ownerName: t.owner?.name ?? null,
    deadline: null, // Track не имеет deadline в модели ТЗ (раздел 11) — см. ANALYSIS.md UNRESOLVED #1
    deadlineWeek: null,
    statusId: t.statusId,
    statusName: t.status?.name ?? null,
    statusColor: t.status?.color ?? null,
    operFlag: t.operFlag,
    comment: null,
    cost: null,
    updatedAt: t.updatedAt,
    staleWeeks: weeksSince(t.updatedAt),
  }));

  const taskRows: TableRow[] = tasks.map((t) => ({
    id: t.id,
    type: "TASK",
    segmentId: t.track.segmentId,
    segmentName: t.track.segment?.name ?? null,
    trackId: t.trackId,
    trackName: t.track.name,
    name: t.title,
    attractivenessId: null, // Task не имеет привлекательности в модели ТЗ (раздел 12)
    attractivenessName: null,
    ownerId: t.ownerId,
    ownerName: t.owner?.name ?? null,
    deadline: t.deadline,
    deadlineWeek: deadlineWeek(t.deadline),
    statusId: t.statusId,
    statusName: t.status?.name ?? null,
    statusColor: t.status?.color ?? null,
    operFlag: t.operFlag,
    comment: t.comment,
    cost: null,
    updatedAt: t.updatedAt,
    staleWeeks: weeksSince(t.updatedAt),
  }));

  const vesselRows: TableRow[] = vesselOptions.map((v) => ({
    id: v.id,
    type: "VESSEL_OPTION",
    segmentId: v.track.segmentId,
    segmentName: v.track.segment?.name ?? null,
    trackId: v.trackId,
    trackName: v.track.name,
    name: v.name,
    attractivenessId: v.attractivenessId,
    attractivenessName: v.attractiveness?.name ?? null,
    ownerId: null, // VesselOption не имеет ownerId (раздел 15, UNRESOLVED #2)
    ownerName: null,
    deadline: null,
    deadlineWeek: null,
    statusId: v.statusId,
    statusName: v.status?.name ?? null,
    statusColor: v.status?.color ?? null,
    operFlag: false,
    comment: v.comment,
    cost: v.cost,
    updatedAt: v.updatedAt,
    staleWeeks: weeksSince(v.updatedAt),
  }));

  return [...trackRows, ...taskRows, ...vesselRows];
}

export function applyTableFilters(rows: TableRow[], filters: TableFilters): TableRow[] {
  return rows.filter((r) => {
    if (filters.segmentId && r.segmentId !== filters.segmentId) return false;
    if (filters.trackId && r.trackId !== filters.trackId) return false;
    if (filters.type && r.type !== filters.type) return false;
    if (filters.statusId && r.statusId !== filters.statusId) return false;
    if (filters.ownerId && r.ownerId !== filters.ownerId) return false;
    if (filters.attractivenessId && r.attractivenessId !== filters.attractivenessId) return false;
    if (filters.week && r.deadlineWeek !== filters.week) return false;
    if (filters.operFlag !== undefined && r.operFlag !== filters.operFlag) return false;
    if (filters.deadlineFrom && (!r.deadline || r.deadline < filters.deadlineFrom)) return false;
    if (filters.deadlineTo && (!r.deadline || r.deadline > filters.deadlineTo)) return false;
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
        return r.trackName;
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
