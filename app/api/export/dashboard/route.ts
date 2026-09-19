import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { canAccessManagerViews } from "@/lib/permissions";
import { computeDashboard } from "@/lib/dashboard";
import { parseExportFormat, renderExport, exportResponse } from "@/lib/export";

// Раздел 37/55: Dashboard и его экспорт — Руководитель (и Куратор, как на самой странице).
export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!canAccessManagerViews(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const format = parseExportFormat(new URL(request.url).searchParams.get("format"));
  if (!format) return NextResponse.json({ error: "INVALID_FORMAT" }, { status: 400 });

  const d = await computeDashboard();
  const fmt = (dt: Date | null) => (dt ? dt.toLocaleDateString("ru-RU") : null);

  const body = await renderExport(format, {
    title: "Dashboard",
    subtitle: `Сформировано ${new Date().toLocaleString("ru-RU")}`,
    sections: [
      {
        title: "KPI",
        headers: ["Показатель", "Значение"],
        rows: [
          ["Треков в работе", d.tracksInProgress],
          ["Просроченных задач", d.overdueTasks],
          ["Активных задач без срока", d.activeTasksNoDeadline],
          ["Активных задач без ответственного", d.activeTasksNoOwner],
          ["Треков на стопе", d.tracksStopped],
          ["Изменений за неделю", d.changesThisWeek],
        ],
      },
      { title: "Нет обновления на этой неделе", headers: ["Трек"], rows: d.noUpdateThisWeek.map((t) => [t.name]) },
      {
        title: "2+ недели без обновления",
        headers: ["Трек", "Недель без отчёта"],
        rows: d.noUpdate2PlusWeeks.map((t) => [t.name, t.weeksSinceLastUpdate]),
      },
      { title: "Никогда не отправляли отчёт", headers: ["Трек"], rows: d.neverSubmitted.map((t) => [t.name]) },
      {
        title: "Нужна помощь руководителя",
        headers: ["Трек", "Неделя отчёта", "Отправлен"],
        rows: d.needManagerHelp.map((t) => [t.name, fmt(t.weekStart), fmt(t.submittedAt)]),
      },
    ],
  });
  return exportResponse(format, body, `dashboard-${new Date().toISOString().slice(0, 10)}`);
}
