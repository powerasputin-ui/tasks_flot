import { prisma } from "@/lib/prisma";
import { deadlineWeek } from "@/lib/deadline-week";

/**
 * Раздел 30 ТЗ (Time Travel): "состояние системы на дату" восстанавливается из
 * Audit — берём ТЕКУЩИЕ значения и откатываем изменения, произошедшие ПОСЛЕ
 * этой даты (по "before" каждого AuditEvent, от новых к старым).
 *
 * Ограничения (следуют из того, что Audit пишется только с момента ввода в
 * эксплуатацию): записи, созданные позже даты, не показываются; изменения,
 * сделанные до появления Audit (например, импорт из Excel), неизвестны.
 */
export type FieldEvent = { fieldName: string | null; before: string | null; timestamp: Date };

export function valuesAsOf(
  current: Record<string, string | null>,
  events: FieldEvent[],
  asOf: Date
): Record<string, string | null> {
  const result = { ...current };
  const later = events
    .filter((e) => e.fieldName && e.timestamp.getTime() > asOf.getTime())
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  for (const e of later) result[e.fieldName!] = e.before;
  return result;
}

export function existedAt(createdAt: Date, archivedAt: Date | null, asOf: Date): boolean {
  return createdAt.getTime() <= asOf.getTime() && (!archivedAt || archivedAt.getTime() > asOf.getTime());
}

export type HistoricalRow = {
  id: string;
  type: "TRACK" | "TASK" | "VESSEL_OPTION";
  segmentName: string | null;
  trackId: string;
  trackName: string;
  name: string;
  attractivenessName: string | null;
  ownerName: string | null;
  deadline: string | null;
  deadlineWeek: number | null;
  statusName: string | null;
  operFlag: boolean;
  cost: string | null;
  comment: string | null;
};

const s = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

export async function loadRowsAsOf(asOf: Date): Promise<HistoricalRow[]> {
  const [tracks, tasks, vessels, events, segments, statuses, attractiveness, users] = await Promise.all([
    prisma.track.findMany(),
    prisma.task.findMany(),
    prisma.vesselOption.findMany(),
    prisma.auditEvent.findMany({
      where: { timestamp: { gt: asOf }, entityType: { in: ["Track", "Task", "VesselOption"] } },
      select: { entityType: true, entityId: true, fieldName: true, before: true, timestamp: true },
    }),
    prisma.segment.findMany(),
    prisma.status.findMany(),
    prisma.attractiveness.findMany(),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);

  const nameOf = (list: Array<{ id: string; name: string }>) => new Map(list.map((x) => [x.id, x.name]));
  const segName = nameOf(segments);
  const statusName = nameOf(statuses);
  const attrName = nameOf(attractiveness);
  const userName = nameOf(users);
  const lookup = (m: Map<string, string>, id: string | null) => (id ? m.get(id) ?? null : null);

  const eventsFor = (type: string, id: string) => events.filter((e) => e.entityType === type && e.entityId === id);

  const trackAt = new Map<string, { name: string; segmentId: string | null }>();
  const trackRows: HistoricalRow[] = [];
  for (const t of tracks) {
    const v = valuesAsOf(
      {
        name: t.name, segmentId: t.segmentId, statusId: t.statusId, ownerId: t.ownerId,
        attractivenessId: t.attractivenessId, operFlag: String(t.operFlag),
      },
      eventsFor("Track", t.id),
      asOf
    );
    trackAt.set(t.id, { name: v.name ?? t.name, segmentId: v.segmentId });
    if (!existedAt(t.createdAt, t.archivedAt, asOf)) continue;
    trackRows.push({
      id: t.id, type: "TRACK", segmentName: lookup(segName, v.segmentId), trackId: t.id, trackName: v.name ?? t.name,
      name: v.name ?? t.name, attractivenessName: lookup(attrName, v.attractivenessId), ownerName: lookup(userName, v.ownerId),
      deadline: null, deadlineWeek: null, statusName: lookup(statusName, v.statusId), operFlag: v.operFlag === "true",
      cost: null, comment: null,
    });
  }

  const taskRows: HistoricalRow[] = [];
  for (const t of tasks) {
    if (!existedAt(t.createdAt, t.archivedAt, asOf)) continue;
    const v = valuesAsOf(
      {
        title: t.title, comment: t.comment, statusId: t.statusId, ownerId: t.ownerId,
        deadline: s(t.deadline), operFlag: String(t.operFlag),
      },
      eventsFor("Task", t.id),
      asOf
    );
    const parent = trackAt.get(t.trackId);
    const deadline = v.deadline ? new Date(v.deadline) : null;
    taskRows.push({
      id: t.id, type: "TASK", segmentName: lookup(segName, parent?.segmentId ?? null), trackId: t.trackId,
      trackName: parent?.name ?? "—", name: v.title ?? t.title, attractivenessName: null, ownerName: lookup(userName, v.ownerId),
      deadline: v.deadline, deadlineWeek: deadlineWeek(deadline), statusName: lookup(statusName, v.statusId),
      operFlag: v.operFlag === "true", cost: null, comment: v.comment,
    });
  }

  const vesselRows: HistoricalRow[] = [];
  for (const o of vessels) {
    if (!existedAt(o.createdAt, o.archivedAt, asOf)) continue;
    const v = valuesAsOf(
      { name: o.name, cost: o.cost, comment: o.comment, statusId: o.statusId, attractivenessId: o.attractivenessId },
      eventsFor("VesselOption", o.id),
      asOf
    );
    const parent = trackAt.get(o.trackId);
    vesselRows.push({
      id: o.id, type: "VESSEL_OPTION", segmentName: lookup(segName, parent?.segmentId ?? null), trackId: o.trackId,
      trackName: parent?.name ?? "—", name: v.name ?? o.name, attractivenessName: lookup(attrName, v.attractivenessId),
      ownerName: null, deadline: null, deadlineWeek: null, statusName: lookup(statusName, v.statusId), operFlag: false,
      cost: v.cost, comment: v.comment,
    });
  }

  return [...trackRows, ...taskRows, ...vesselRows];
}
