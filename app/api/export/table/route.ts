import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { loadTableRows, applyTableFilters, applyTableSort, type RecordType } from "@/lib/table-view";
import { parseExportFormat, renderExport, exportResponse } from "@/lib/export";

const TYPE_LABEL: Record<RecordType, string> = { TRACK: "Трек", TASK: "Задача", VESSEL_OPTION: "Судно" };

// Раздел 55: экспорт "Current Table" — те же фильтры/сортировка, что у /api/table.
// Читать таблицу могут все роли (раздел 35-37), поэтому и экспорт доступен всем.
export async function GET(request: NextRequest) {
  await requireSession();
  const { searchParams } = new URL(request.url);
  const format = parseExportFormat(searchParams.get("format"));
  if (!format) return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });

  const rows = applyTableSort(
    applyTableFilters(await loadTableRows(), {
      segmentId: searchParams.get("segmentId") ?? undefined,
      trackId: searchParams.get("trackId") ?? undefined,
      type: (searchParams.get("type") as RecordType) ?? undefined,
      statusId: searchParams.get("statusId") ?? undefined,
      ownerId: searchParams.get("ownerId") ?? undefined,
      attractivenessId: searchParams.get("attractivenessId") ?? undefined,
      week: searchParams.get("week") ? Number(searchParams.get("week")) : undefined,
      operFlag: searchParams.get("operFlag") ? searchParams.get("operFlag") === "true" : undefined,
      deadlineFrom: searchParams.get("deadlineFrom") ? new Date(searchParams.get("deadlineFrom")!) : undefined,
      deadlineTo: searchParams.get("deadlineTo") ? new Date(searchParams.get("deadlineTo")!) : undefined,
    }),
    {
      sortBy: (searchParams.get("sortBy") as never) ?? undefined,
      sortDir: (searchParams.get("sortDir") as "asc" | "desc") ?? undefined,
    }
  );

  const headers = ["Тип", "Сегмент", "Трек", "Название", "Оценка $", "Привлекательность", "Ответственный", "Срок", "Неделя", "Статус", "Опер", "Комментарий"];
  const data = rows.map((r) => [
    TYPE_LABEL[r.type],
    r.segmentName,
    r.trackName,
    r.name,
    r.cost,
    r.attractivenessName ?? "P0",
    r.ownerName,
    r.deadline ? r.deadline.toLocaleDateString("ru-RU") : null,
    r.deadlineWeek,
    r.statusName,
    r.type === "VESSEL_OPTION" ? null : r.operFlag ? "да" : "нет",
    r.comment,
  ]);

  const body = await renderExport(format, {
    title: "Треки, задачи и варианты судов",
    subtitle: `Выгрузка от ${new Date().toLocaleString("ru-RU")} · записей: ${rows.length}`,
    sections: [{ title: "Таблица", headers, rows: data }],
  });
  return exportResponse(format, body, `tracks-${new Date().toISOString().slice(0, 10)}`);
}
