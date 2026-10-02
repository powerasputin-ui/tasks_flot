import { exportLimited } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canViewItems } from "@/lib/permissions";
import { canSeeSent, requireDirectorate } from "@/lib/scope";
import { archiveTableSections, diffArchiveTables, filterArchiveRows, withoutMemoMarks, type ArchiveView } from "@/lib/archive-table";
import { exportResponse, parseExportFormat, renderExport } from "@/lib/export";
import { loadVersionTable } from "@/lib/archive-table-load";
import { withApiErrors } from "@/lib/api-guard";

/**
 * Таблица недели (последняя отправленная ревизия) и что изменилось с предыдущей недели своей дирекции.
 * Чужая дирекция и неоконченная оперативка — 404.
 */
async function GETHandler(request: NextRequest, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const actor = await requireActor();
  if (!canViewItems(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const directorateId = requireDirectorate(actor);

  const cycle = await prisma.cycle.findFirst({ where: { id: cycleId, directorateId, status: "FINAL" } });
  if (!cycle) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const version = await prisma.memoVersion.findFirst({ where: { cycleId, directorateId }, orderBy: { revision: "desc" } });
  if (!version) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // руководителю — только «подано»: что вошло в справку, он не видит (см. canSeeSent)
  const memoVisible = canSeeSent(actor, directorateId);
  const full = await loadVersionTable(version, cycle.snapshot);
  const table = memoVisible ? full : withoutMemoMarks(full);

  const sp = new URL(request.url).searchParams;
  if (sp.has("format")) {
  const tooMany = await exportLimited(actor.id);
  if (tooMany) return tooMany;
    const format = parseExportFormat(sp.get("format"));
    if (!format) return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });
    const allowed: ArchiveView[] = memoVisible ? ["all", "submitted", "memo"] : ["all", "submitted"];
    const view = (allowed as string[]).includes(sp.get("view") ?? "") ? (sp.get("view") as ArchiveView) : "all";
    const rows = filterArchiveRows(table.rows, { view, q: sp.get("q") ?? "", segmentId: sp.get("segment") || null });
    const date = version.sentAt.toLocaleDateString("ru-RU");
    const body = await renderExport(format, {
      title: `Неделя №${cycle.number} — таблица на ${date}`,
      subtitle: `Ред. ${version.revision} · отправлена ${date} · строк: ${rows.length}`,
      sections: archiveTableSections(table, rows, { memo: memoVisible }),
    });
    return exportResponse(format, body, `nedelya-${cycle.number}-tablica-${version.sentAt.toISOString().slice(0, 10)}`);
  }

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
    memoVisible,
    week: { cycleId, number: cycle.number, meetingDate: cycle.meetingDate?.toISOString() ?? null, sentAt: version.sentAt.toISOString(), revision: version.revision },
    table,
    prev,
    diff,
  });
}

export const GET = withApiErrors(GETHandler);
