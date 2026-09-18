import { prisma } from "@/lib/prisma";
import { startOfISOWeek } from "date-fns";

/**
 * Раздел 45-50 ТЗ. Все KPI считаются детерминированно, без AI (раздел 105,
 * запрет №8). "Просрочено" исключает "Завершено" И "Не актуально" (раздел 46:
 * "Не актуально по умолчанию не считается просроченной").
 */

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export type TrackRef = { id: string; name: string };

export type DashboardData = {
  tracksInProgress: number;
  overdueTasks: number;
  activeTasksNoDeadline: number;
  activeTasksNoOwner: number;
  tracksStopped: number;
  changesThisWeek: number;
  noUpdateThisWeek: TrackRef[];
  noUpdate2PlusWeeks: Array<TrackRef & { weeksSinceLastUpdate: number }>;
  neverSubmitted: TrackRef[];
  needManagerHelp: Array<TrackRef & { weekStart: Date; submittedAt: Date | null }>;
};

export async function computeDashboard(): Promise<DashboardData> {
  const now = new Date();
  const currentWeekStart = startOfISOWeek(now);

  const [tracks, tasks, weeklyUpdates, changesThisWeek] = await Promise.all([
    prisma.track.findMany({
      where: { archivedAt: null },
      include: { status: true },
    }),
    prisma.task.findMany({
      where: { archivedAt: null },
      include: { status: true },
    }),
    prisma.weeklyUpdate.findMany({
      where: { status: "SUBMITTED" },
      orderBy: { weekStart: "desc" },
    }),
    prisma.auditEvent.count({ where: { timestamp: { gte: currentWeekStart } } }),
  ]);

  // Раздел 46: просрочено = не Завершено, не Не актуально, deadline < сегодня.
  const overdueTasks = tasks.filter(
    (t) =>
      t.deadline &&
      t.deadline < now &&
      t.status?.name !== "Завершено" &&
      t.status?.name !== "Не актуально"
  ).length;

  // Раздел 47.
  const activeTasksNoDeadline = tasks.filter((t) => t.status?.name === "В работе" && !t.deadline).length;

  // Раздел 48.
  const activeTasksNoOwner = tasks.filter((t) => t.status?.name === "В работе" && !t.ownerId).length;

  // Раздел 45/49.
  const tracksInProgress = tracks.filter((t) => t.status?.name === "В работе").length;
  const tracksStopped = tracks.filter((t) => t.status?.name === "На стопе").length;

  // Последний SUBMITTED WeeklyUpdate на трек (раздел 22).
  const lastSubmittedByTrack = new Map<string, (typeof weeklyUpdates)[number]>();
  for (const wu of weeklyUpdates) {
    if (!lastSubmittedByTrack.has(wu.trackId)) lastSubmittedByTrack.set(wu.trackId, wu);
  }

  const noUpdateThisWeek: TrackRef[] = [];
  const noUpdate2PlusWeeks: Array<TrackRef & { weeksSinceLastUpdate: number }> = [];
  const neverSubmitted: TrackRef[] = [];

  for (const track of tracks) {
    const last = lastSubmittedByTrack.get(track.id);
    if (!last) {
      neverSubmitted.push({ id: track.id, name: track.name });
      continue;
    }
    const weeksSince = Math.round((currentWeekStart.getTime() - last.weekStart.getTime()) / MS_PER_WEEK);
    if (weeksSince >= 2) {
      noUpdate2PlusWeeks.push({ id: track.id, name: track.name, weeksSinceLastUpdate: weeksSince });
    } else if (weeksSince >= 1) {
      noUpdateThisWeek.push({ id: track.id, name: track.name });
    }
  }

  const needManagerHelp = [...lastSubmittedByTrack.entries()]
    .filter(([, wu]) => wu.needManagerHelp)
    .map(([trackId, wu]) => {
      const track = tracks.find((t) => t.id === trackId);
      return { id: trackId, name: track?.name ?? "—", weekStart: wu.weekStart, submittedAt: wu.submittedAt };
    });

  return {
    tracksInProgress,
    overdueTasks,
    activeTasksNoDeadline,
    activeTasksNoOwner,
    tracksStopped,
    changesThisWeek,
    noUpdateThisWeek,
    noUpdate2PlusWeeks,
    neverSubmitted,
    needManagerHelp,
  };
}
