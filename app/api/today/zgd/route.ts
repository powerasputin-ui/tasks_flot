import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { withApiErrors } from "@/lib/api-guard";
import { burstLimited } from "@/lib/rate-limit";
import { loadZgdSources } from "@/lib/tracker-load";
import { buildZgdAnalytics } from "@/lib/zgd-analytics";

// «Мой день» ЗГД: дирекции, динамика, поручения — только из подтверждённого директорами (справки и «Обновить для ЗГД»).
// Доступ — только ЗГД: остальные роли видят рабочие таблицы и считать им это не нужно.
async function GETHandler() {
  const actor = await requireActor();
  if (actor.role !== "EXECUTIVE") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const tooMany = burstLimited(`zgd-analytics:${actor.id}`, 20, 60_000);
  if (tooMany) return tooMany;
  const [{ versions, publications }, directorates, statuses] = await Promise.all([
    loadZgdSources(),
    prisma.directorate.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, shortName: true } }),
    prisma.status.findMany({ select: { name: true, trackerColumn: true } }),
  ]);
  const ids = [...new Set([...versions.flatMap((v) => v.rows.map((r) => r.id)), ...publications.map((p) => p.itemId)])];
  // пометки самого ЗГД (поручение, контроль) — живые; удалённые дирекцией задачи не учитываются
  const live = ids.length ? await prisma.operationalItem.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true, origin: true, assignedById: true, assignedAt: true, zgdControl: true } }) : [];
  const data = buildZgdAnalytics({
    versions,
    publications,
    directorates: directorates.map((d) => ({ id: d.id, name: d.shortName || d.name })),
    statusColumns: new Map(statuses.map((s) => [s.name, s.trackerColumn])),
    live,
    meId: actor.id,
    now: Date.now(),
  });
  return NextResponse.json(data);
}

export const GET = withApiErrors(GETHandler);
