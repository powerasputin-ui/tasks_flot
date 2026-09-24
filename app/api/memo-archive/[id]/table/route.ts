import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canViewVersion } from "@/lib/memo-versions";
import { exportResponse, parseExportFormat, renderExport } from "@/lib/export";
import { archiveTableSections, filterArchiveRows, legacyArchiveTable, type ArchiveLayout, type ArchiveRow, type ArchiveTable, type ArchiveView } from "@/lib/archive-table";
import { withApiErrors } from "@/lib/api-guard";

/**
 * Таблица оперативки на момент отправки этой версии справки (только чтение). Права — те же, что у справки.
 * ?format=xlsx|pdf|csv — выгрузка снимка (с фильтром ?view=all|submitted|memo&q=&segment=).
 */
async function GETHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const v = await prisma.memoVersion.findUnique({ where: { id }, include: { cycle: { select: { number: true, snapshot: true } } } });
  if (!v || !canViewVersion(actor, v)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const takenAt = v.sentAt.toISOString();
  let table: ArchiveTable;
  if (Array.isArray(v.rows) && v.columns && typeof v.columns === "object") {
    table = { mode: "full", takenAt, ...(v.columns as unknown as ArchiveLayout), rows: v.rows as unknown as ArchiveRow[] };
  } else {
    // справка отправлена до того, как стали сохранять таблицу целиком: Cycle.snapshot относится к последней отправке цикла
    const last = await prisma.memoVersion.findFirst({ where: { cycleId: v.cycleId }, orderBy: { revision: "desc" }, select: { id: true } });
    const inMemo = (Array.isArray(v.sources) ? (v.sources as Array<{ id: string }>) : []).map((s) => s.id);
    table =
      last?.id === v.id && Array.isArray(v.cycle.snapshot)
        ? legacyArchiveTable(v.cycle.snapshot, inMemo, takenAt)
        : { mode: "none", takenAt, columns: [], segments: [], rows: [] };
  }

  const sp = new URL(request.url).searchParams;
  if (!sp.has("format")) return NextResponse.json(table);

  const format = parseExportFormat(sp.get("format"));
  if (!format) return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });
  const view = (["all", "submitted", "memo"].includes(sp.get("view") ?? "") ? sp.get("view") : "all") as ArchiveView;
  const rows = filterArchiveRows(table.rows, { view, q: sp.get("q") ?? "", segmentId: sp.get("segment") || null });
  const date = v.sentAt.toLocaleDateString("ru-RU");
  const body = await renderExport(format, {
    title: `Оперативка №${v.cycle.number} — таблица на ${date}`,
    subtitle: `Ред. ${v.revision} · отправлена ${date} · строк: ${rows.length}`,
    sections: archiveTableSections(table, rows),
  });
  return exportResponse(format, body, `operativka-${v.cycle.number}-red${v.revision}-tablica-${v.sentAt.toISOString().slice(0, 10)}`);
}

export const GET = withApiErrors(GETHandler);
