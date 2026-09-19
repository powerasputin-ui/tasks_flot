import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { canExportWorkTable, itemVisibilityWhere } from "@/lib/permissions";
import { applyTableFilters, applyTableSort, loadTableRows, type ArchiveMode, type TableSort } from "@/lib/table-view";
import { parseExportFormat, renderExport, exportResponse } from "@/lib/export";

// Экспорт «текущей таблицы» с теми же фильтрами и сортировкой, что у /api/items.
// Руководитель отдела выгружает только свой отдел (границы задаёт сервер).
export async function GET(request: NextRequest) {
  const actor = await requireActor();
  if (!canExportWorkTable(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const scope = itemVisibilityWhere(actor);
  if (!scope) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const format = parseExportFormat(sp.get("format"));
  if (!format) return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });
  const archive = (["active", "archived", "all"].includes(sp.get("archive") ?? "") ? sp.get("archive") : "active") as ArchiveMode;
  const date = (k: string) => (sp.get(k) ? new Date(sp.get(k)!) : undefined);

  const rows = applyTableSort(
    applyTableFilters(await loadTableRows(scope, archive), {
      departmentId: sp.get("departmentId") ?? undefined,
      segmentId: sp.get("segmentId") ?? undefined,
      trackId: sp.get("trackId") ?? undefined,
      statusId: sp.get("statusId") ?? undefined,
      ownerId: sp.get("ownerId") ?? undefined,
      attractivenessId: sp.get("attractivenessId") ?? undefined,
      week: sp.get("week") ? Number(sp.get("week")) : undefined,
      operFlag: sp.get("operFlag") ? sp.get("operFlag") === "true" : undefined,
      deadlineFrom: date("deadlineFrom"),
      deadlineTo: date("deadlineTo"),
      q: sp.get("q") ?? undefined,
    }),
    { sortBy: (sp.get("sortBy") as TableSort["sortBy"]) ?? undefined, sortDir: (sp.get("sortDir") as "asc" | "desc") ?? undefined }
  );

  const headers = ["Подразделение", "Сегмент", "Трек", "Название", "Оценка $", "Привлекательность", "Ответственный", "Срок", "Неделя", "Статус", "Опер", "Комментарий"];
  const data = rows.map((r) => [
    r.departmentName,
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
  ]);

  const body = await renderExport(format, {
    title: "Оперативка: рабочая таблица",
    subtitle: `Выгрузка от ${new Date().toLocaleString("ru-RU")} · записей: ${rows.length}`,
    sections: [{ title: "Таблица", headers, rows: data }],
  });
  return exportResponse(format, body, `operativka-${new Date().toISOString().slice(0, 10)}`);
}
