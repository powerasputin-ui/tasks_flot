import type { WeeklyDigestContent } from "@/lib/weekly-digest";
import type { ExportSection } from "@/lib/export";

/**
 * Раздел 56/92 ТЗ: единый ReportData. Все рендереры (CSV/XLSX/PDF/PPTX) получают
 * данные только отсюда — отдельной бизнес-логики для PPTX нет.
 */
export type ReportData = {
  title: string;
  subtitle: string;
  sections: ExportSection[];
};

export function buildWeeklyDigestReportData(
  digest: { weekStart: Date; weekEnd: Date; status: "DRAFT" | "FINAL" },
  c: WeeklyDigestContent
): ReportData {
  const d = (iso: string) => new Date(iso).toLocaleString("ru-RU");
  return {
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
  };
}
