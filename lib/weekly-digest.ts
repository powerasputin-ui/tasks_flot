import { prisma } from "@/lib/prisma";
import { computeDashboard } from "@/lib/dashboard";

/**
 * Раздел 24-26 ТЗ: содержимое WeeklyDigest.
 * Раздел 25: считается детерминированно из Track/Task/VesselOption/
 * WeeklyUpdate/AuditEvent — без AI. AI (раздел 60-65) — необязательный
 * дополнительный слой над этим, который в Phase 2 не строится.
 */

export type ChangeEntry = {
  entityType: string;
  entityId: string;
  entityName: string;
  action: string;
  fieldName: string | null;
  before: string | null;
  after: string | null;
  timestamp: string;
  actorName: string | null;
};

export type WeeklyDigestContent = {
  summary: {
    tracksInProgress: number;
    tracksStopped: number;
    changesCount: number;
    newRecords: number;
    archivedRecords: number;
  };
  changes: ChangeEntry[];
  bySegment: Array<{
    segmentId: string | null;
    segmentName: string;
    trackCount: number;
    statusBreakdown: Record<string, number>;
  }>;
  highAttractiveness: Array<{ id: string; type: "Track" | "VesselOption"; name: string; trackName: string }>;
  stopped: Array<{ id: string; name: string }>;
  notRelevant: Array<{ id: string; type: "Track" | "Task" | "VesselOption"; name: string }>;
  noUpdate: {
    thisWeek: Array<{ id: string; name: string }>;
    twoPlusWeeks: Array<{ id: string; name: string; weeksSinceLastUpdate: number }>;
    neverSubmitted: Array<{ id: string; name: string }>;
  };
  managerHelp: Array<{ id: string; name: string; weekStart: string }>;
};

export async function computeWeeklyDigestContent(weekStart: Date, weekEnd: Date): Promise<WeeklyDigestContent> {
  const [tracks, tasks, vesselOptions, weeklyUpdatesAll, auditEvents, dashboard] = await Promise.all([
    prisma.track.findMany({
      where: { archivedAt: null },
      include: { segment: true, status: true, attractiveness: true },
    }),
    prisma.task.findMany({ where: { archivedAt: null }, include: { status: true, track: true } }),
    prisma.vesselOption.findMany({
      where: { archivedAt: null },
      include: { status: true, attractiveness: true, track: true },
    }),
    prisma.weeklyUpdate.findMany({ include: { track: { select: { name: true } } } }),
    prisma.auditEvent.findMany({
      where: { timestamp: { gte: weekStart, lte: weekEnd } },
      include: { actor: { select: { name: true } } },
      orderBy: { timestamp: "desc" },
    }),
    computeDashboard(),
  ]);

  const trackNameById = new Map(tracks.map((t) => [t.id, t.name]));
  const taskNameById = new Map(tasks.map((t) => [t.id, t.title]));
  const vesselNameById = new Map(vesselOptions.map((v) => [v.id, v.name]));
  const weeklyUpdateTrackNameById = new Map(weeklyUpdatesAll.map((w) => [w.id, w.track.name]));

  function entityName(entityType: string, entityId: string): string {
    if (entityType === "Track") return trackNameById.get(entityId) ?? "(удалено/архивировано)";
    if (entityType === "Task") return taskNameById.get(entityId) ?? "(удалено/архивировано)";
    if (entityType === "VesselOption") return vesselNameById.get(entityId) ?? "(удалено/архивировано)";
    if (entityType === "WeeklyUpdate") {
      const trackName = weeklyUpdateTrackNameById.get(entityId);
      return trackName ? `Отчёт по треку «${trackName}»` : "Еженедельный отчёт";
    }
    return entityId;
  }

  const changes: ChangeEntry[] = auditEvents.map((e) => ({
    entityType: e.entityType,
    entityId: e.entityId,
    entityName: entityName(e.entityType, e.entityId),
    action: e.action,
    fieldName: e.fieldName,
    before: e.before,
    after: e.after,
    timestamp: e.timestamp.toISOString(),
    actorName: e.actor?.name ?? null,
  }));

  const bySegmentMap = new Map<
    string,
    { segmentId: string | null; segmentName: string; trackCount: number; statusBreakdown: Record<string, number> }
  >();
  for (const t of tracks) {
    const key = t.segmentId ?? "none";
    if (!bySegmentMap.has(key)) {
      bySegmentMap.set(key, {
        segmentId: t.segmentId,
        segmentName: t.segment?.name ?? "Без сегмента",
        trackCount: 0,
        statusBreakdown: {},
      });
    }
    const entry = bySegmentMap.get(key)!;
    entry.trackCount++;
    const statusName = t.status?.name ?? "Без статуса";
    entry.statusBreakdown[statusName] = (entry.statusBreakdown[statusName] ?? 0) + 1;
  }

  const highAttractiveness: WeeklyDigestContent["highAttractiveness"] = [
    ...tracks
      .filter((t) => t.attractiveness?.name === "P100")
      .map((t) => ({ id: t.id, type: "Track" as const, name: t.name, trackName: t.name })),
    ...vesselOptions
      .filter((v) => v.attractiveness?.name === "P100")
      .map((v) => ({ id: v.id, type: "VesselOption" as const, name: v.name, trackName: v.track.name })),
  ];

  const stopped = tracks.filter((t) => t.status?.name === "На стопе").map((t) => ({ id: t.id, name: t.name }));

  const notRelevant: WeeklyDigestContent["notRelevant"] = [
    ...tracks.filter((t) => t.status?.name === "Не актуально").map((t) => ({ id: t.id, type: "Track" as const, name: t.name })),
    ...tasks.filter((t) => t.status?.name === "Не актуально").map((t) => ({ id: t.id, type: "Task" as const, name: t.title })),
    ...vesselOptions
      .filter((v) => v.status?.name === "Не актуально")
      .map((v) => ({ id: v.id, type: "VesselOption" as const, name: v.name })),
  ];

  const newRecords = changes.filter((c) => c.action === "CREATE").length;
  const archivedRecords = changes.filter((c) => c.action === "ARCHIVE").length;

  return {
    summary: {
      tracksInProgress: dashboard.tracksInProgress,
      tracksStopped: dashboard.tracksStopped,
      changesCount: changes.length,
      newRecords,
      archivedRecords,
    },
    changes,
    bySegment: [...bySegmentMap.values()],
    highAttractiveness,
    stopped,
    notRelevant,
    noUpdate: {
      thisWeek: dashboard.noUpdateThisWeek,
      twoPlusWeeks: dashboard.noUpdate2PlusWeeks,
      neverSubmitted: dashboard.neverSubmitted,
    },
    managerHelp: dashboard.needManagerHelp.map((h) => ({
      id: h.id,
      name: h.name,
      weekStart: h.weekStart.toISOString(),
    })),
  };
}
