import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canViewItems } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { diffArchiveTables } from "@/lib/archive-table";
import { loadVersionTable } from "@/lib/archive-table-load";
import { withApiErrors } from "@/lib/api-guard";

/**
 * Таблица недели (последняя отправленная ревизия) и что изменилось с предыдущей недели своей дирекции.
 * Чужая дирекция и неоконченная оперативка — 404.
 */
async function GETHandler(_request: NextRequest, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const actor = await requireActor();
  if (!canViewItems(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const directorateId = requireDirectorate(actor);

  const cycle = await prisma.cycle.findFirst({ where: { id: cycleId, directorateId, status: "FINAL" } });
  if (!cycle) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const version = await prisma.memoVersion.findFirst({ where: { cycleId, directorateId }, orderBy: { revision: "desc" } });
  if (!version) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const table = await loadVersionTable(version, cycle.snapshot);

  // предыдущая неделя — ближайшая завершённая оперативка с меньшим номером, у которой есть отправленная версия
  const prevCycle = await prisma.cycle.findFirst({
    where: { directorateId, status: "FINAL", number: { lt: cycle.number }, versions: { some: {} } },
    orderBy: { number: "desc" },
  });
  let prev: { cycleId: string; number: number } | null = null;
  let diff = null;
  if (prevCycle) {
    prev = { cycleId: prevCycle.id, number: prevCycle.number };
    const prevVersion = await prisma.memoVersion.findFirst({ where: { cycleId: prevCycle.id, directorateId }, orderBy: { revision: "desc" } });
    if (prevVersion) diff = diffArchiveTables(await loadVersionTable(prevVersion, prevCycle.snapshot), table);
  }

  return NextResponse.json({
    week: { cycleId, number: cycle.number, meetingDate: cycle.meetingDate?.toISOString() ?? null, sentAt: version.sentAt.toISOString(), revision: version.revision },
    table,
    prev,
    diff,
  });
}

export const GET = withApiErrors(GETHandler);
