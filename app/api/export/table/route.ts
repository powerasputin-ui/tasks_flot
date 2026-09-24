import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { requireDirectorate } from "@/lib/scope";
import { canExportWorkTable } from "@/lib/permissions";
import { applyTableFilters, applyTableSort, loadTableRows, type ArchiveMode, type TableSort } from "@/lib/table-view";
import { prisma } from "@/lib/prisma";
import { parseExportFormat, renderExport, exportResponse } from "@/lib/export";
import { withApiErrors } from "@/lib/api-guard";

// Экспорт «текущей таблицы» с теми же фильтрами и сортировкой, что у /api/items.
// Руководитель и куратор выгружают все позиции (руководитель их видит, править может только свои).
async function GETHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!canExportWorkTable(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const format = parseExportFormat(sp.get("format"));
  if (!format) return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });
  const archive = (["active", "archived", "all"].includes(sp.get("archive") ?? "") ? sp.get("archive") : "active") as ArchiveMode;
  const date = (k: string) => (sp.get(k) ? new Date(sp.get(k)!) : undefined);
  const list = (k: string) => (sp.get(k) ? sp.get(k)!.split(",").filter(Boolean) : undefined);

  const rows = applyTableSort(
    applyTableFilters(await loadTableRows(archive, requireDirectorate(actor)), {
      segmentIds: sp.get("segmentIds") ? sp.get("segmentIds")!.split(",").filter(Boolean) : undefined,
      trackIds: list("trackIds"),
      statusIds: list("statusIds"),
      ownerIds: list("ownerIds"),
      attractivenessIds: list("attractivenessIds"),
      week: sp.get("week") ? Number(sp.get("week")) : undefined,
      operFlag: sp.get("operFlag") ? sp.get("operFlag") === "true" : undefined,
      deadlineFrom: date("deadlineFrom"),
      deadlineTo: date("deadlineTo"),
      q: sp.get("q") ?? undefined,
    }),
    { sortBy: (sp.get("sortBy") as TableSort["sortBy"]) ?? undefined, sortDir: (sp.get("sortDir") as "asc" | "desc") ?? undefined }
  );

  // свои колонки куратора — в конец таблицы выгрузки
  const custom = await prisma.customColumn.findMany({ where: { isActive: true, directorateId: requireDirectorate(actor) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const headers = ["Сегмент", "Трек", "Задача", "Оценка $", "Привлекательность", "Ответственный", "Дедлайн", "Неделя", "Статус", "Оперативка", "Комментарий", ...custom.map((c) => c.name)];
  const data = rows.map((r) => [
    r.segmentName,
    r.trackName,
    r.name,
    r.cost,
    r.attractivenessName ?? "P0",
    r.ownerName,
    r.deadline ? r.deadline.toLocaleDateString("ru-RU") : null,
    r.deadlineWeek,
    r.statusName,
    r.operFlag ? "да" : "нет",
    r.comment,
    ...custom.map((c) => {
      const v = r.customValues[c.id];
      return v && c.type === "DATE" ? new Date(v).toLocaleDateString("ru-RU") : v ?? null;
    }),
  ]);

  const body = await renderExport(format, {
    title: "Оперативка: рабочая таблица",
    subtitle: `Выгрузка от ${new Date().toLocaleString("ru-RU")} · записей: ${rows.length}`,
    sections: [{ title: "Таблица", headers, rows: data }],
  });
  return exportResponse(format, body, `operativka-${new Date().toISOString().slice(0, 10)}`);
}

export const GET = withApiErrors(GETHandler);
