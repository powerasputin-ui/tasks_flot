import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canAccessManagerViews } from "@/lib/permissions";
import type { WeeklyDigestContent } from "@/lib/weekly-digest";
import { parseExportFormat, renderExport, exportResponse } from "@/lib/export";

// Раздел 23-26/55: экспортируется уже сохранённый дайджест (не пересчёт на лету).
export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!canAccessManagerViews(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const format = parseExportFormat(searchParams.get("format"));
  const id = searchParams.get("id");
  if (!format || !id) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const digest = await prisma.weeklyDigest.findUnique({ where: { id } });
  if (!digest) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const c = digest.content as unknown as WeeklyDigestContent;
  const d = (iso: string) => new Date(iso).toLocaleString("ru-RU");

  const body = await renderExport(format, {
    title: "Дайджест недели",
    subtitle: `${digest.weekStart.toLocaleDateString("ru-RU")} — ${digest.weekEnd.toLocaleDateString("ru-RU")} · ${
      digest.status === "FINAL" ? "финальный" : "черновик"
    }`,
    sections: [
      {
        title: "Итог",
        headers: ["Показатель", "Значение"],
        rows: [
          ["Треков в работе", c.summary.tracksInProgress],
          ["На стопе", c.summary.tracksStopped],
          ["Изменений", c.summary.changesCount],
          ["Новых записей", c.summary.newRecords],
          ["Архивировано", c.summary.archivedRecords],
        ],
      },
      {
        title: "Изменения за неделю",
        headers: ["Время", "Кто", "Запись", "Действие", "Поле", "Было", "Стало"],
        rows: c.changes.map((x) => [d(x.timestamp), x.actorName ?? "система", x.entityName, x.action, x.fieldName, x.before, x.after]),
      },
      {
        title: "По сегментам",
        headers: ["Сегмент", "Треков", "Статусы"],
        rows: c.bySegment.map((s) => [
          s.segmentName,
          s.trackCount,
          Object.entries(s.statusBreakdown).map(([k, v]) => `${k}: ${v}`).join("; "),
        ]),
      },
      {
        title: "Высокая привлекательность (P100)",
        headers: ["Название", "Тип", "Трек"],
        rows: c.highAttractiveness.map((h) => [h.name, h.type === "Track" ? "трек" : "судно", h.trackName]),
      },
      { title: "На стопе", headers: ["Трек"], rows: c.stopped.map((t) => [t.name]) },
      { title: "Не актуально", headers: ["Название", "Тип"], rows: c.notRelevant.map((t) => [t.name, t.type]) },
      {
        title: "Нет обновлений",
        headers: ["Трек", "Категория"],
        rows: [
          ...c.noUpdate.thisWeek.map((t) => [t.name, "нет отчёта на этой неделе"]),
          ...c.noUpdate.twoPlusWeeks.map((t) => [t.name, `${t.weeksSinceLastUpdate} нед. без отчёта`]),
          ...c.noUpdate.neverSubmitted.map((t) => [t.name, "никогда не отправляли"]),
        ],
      },
      { title: "Нужна помощь руководителя", headers: ["Трек"], rows: c.managerHelp.map((t) => [t.name]) },
    ],
  });
  return exportResponse(format, body, `weekly-digest-${digest.weekStart.toISOString().slice(0, 10)}`);
}
