import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canViewItems } from "@/lib/permissions";
import { describeAuditAction, formatAuditValue, type NameMaps } from "@/lib/audit-format";

// Лента последних изменений по видимым пользователю позициям (сегмент — необязательный фильтр).
export async function GET(request: NextRequest) {
  const actor = await requireActor();
  if (!canViewItems(actor.role)) return NextResponse.json({ events: [] });

  const sp = new URL(request.url).searchParams;
  const segmentIds = (sp.get("segmentIds") ?? "").split(",").filter(Boolean);
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 30, 1), 100);

  const items = await prisma.operationalItem.findMany({
    where: segmentIds.length
      ? { OR: [{ segmentId: { in: segmentIds.filter((s) => s !== "none") } }, ...(segmentIds.includes("none") ? [{ segmentId: null }] : [])] }
      : {},
    select: { id: true, title: true },
  });
  if (items.length === 0) return NextResponse.json({ events: [] });
  const titleById = new Map(items.map((i) => [i.id, i.title]));

  const [events, segments, tracks, attractiveness, statuses, users] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { entityType: "OperationalItem", entityId: { in: [...titleById.keys()] } },
      include: { actor: { select: { name: true } } },
      orderBy: { timestamp: "desc" },
      take: limit,
    }),
    prisma.segment.findMany({ select: { id: true, name: true } }),
    prisma.track.findMany({ select: { id: true, name: true } }),
    prisma.attractiveness.findMany({ select: { id: true, name: true } }),
    prisma.status.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);

  const map = (list: Array<{ id: string; name: string }>) => new Map(list.map((x) => [x.id, x.name]));
  const maps: NameMaps = {
    segmentId: map(segments),
    trackId: map(tracks),
    attractivenessId: map(attractiveness),
    statusId: map(statuses),
    responsibleId: map(users),
  };

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      timestamp: e.timestamp.toISOString(),
      actorName: e.actor?.name ?? "Система",
      itemId: e.entityId,
      itemTitle: titleById.get(e.entityId) ?? "—",
      action: e.action,
      what: describeAuditAction(e.action, e.fieldName),
      field: e.fieldName,
      before: e.fieldName ? formatAuditValue(e.fieldName, e.before, maps) : null,
      after: e.fieldName ? formatAuditValue(e.fieldName, e.after, maps) : null,
    })),
  });
}
