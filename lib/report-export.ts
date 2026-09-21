import type { ExportSection } from "@/lib/export";
import { groupLevelLabel, type ReportGroup, type ReportModel } from "@/lib/report";

/**
 * Модель отчёта → секции для CSV / Excel / PDF (те же, что у остальных выгрузок).
 * Заголовки групп идут отдельными строками с числом позиций (с отступом по уровню), комментарий — строкой под задачей.
 */
export function reportToSections(model: ReportModel, opts: { summary?: boolean } = {}): ExportSection[] {
  const sections: ExportSection[] = [];

  if (model.showSummary && opts.summary !== false) {
    const s = model.summary;
    sections.push({
      title: "Статус текущих задач",
      headers: ["Показатель", "Количество"],
      rows: [["Всего задач", s.total], ...s.byStatus.map((st) => [st.name, st.count] as [string, number]), ["Просрочено", s.overdue], ["Отправлено куратору", s.sent]],
    });
  }

  const width = Math.max(model.columns.length, 1);
  const blank = (first: string): Array<string | number | null> => [first, ...Array(width - 1).fill("")];
  const rows: Array<Array<string | number | null>> = [];

  const pushRows = (list: ReportGroup["rows"], indent: string) => {
    if (model.columns.length === 0) return; // колонок не выбрано — строки задач не выводим
    for (const r of list ?? []) {
      rows.push(model.columns.map((c, i) => (i === 0 ? indent + r.cells[c.key] : r.cells[c.key])));
      if (r.comment) rows.push(blank(`${indent}    Комментарий: ${r.comment}`));
    }
  };
  const walk = (groups: ReportGroup[], depth: number) => {
    for (const g of groups) {
      const indent = "    ".repeat(depth);
      rows.push(blank(`${indent}${groupLevelLabel(g.level)}: ${g.label} (${g.count})`));
      if (g.groups) walk(g.groups, depth + 1);
      else pushRows(g.rows, indent + "    ");
    }
  };

  if (model.groups) walk(model.groups, 0);
  else pushRows(model.rows ?? [], "");

  sections.push({ title: model.title, headers: model.columns.length ? model.columns.map((c) => c.label) : [""], rows });
  return sections;
}

const ruDateTime = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Заголовок и подзаголовок файла. */
export function reportFileHeader(model: ReportModel): { title: string; subtitle: string } {
  return { title: model.directorate, subtitle: `${model.title} · сформировано ${ruDateTime(model.generatedAt)} · позиций: ${model.summary.total}` };
}

/** Шапка PDF: название документа и дата; название отчёта («Оперативка») идёт заголовком таблицы. */
export function reportPdfHeader(model: ReportModel): { title: string; subtitle: string } {
  const isDefault = model.directorate.startsWith("Дирекция по развитию флота");
  const who = isDefault ? "дирекции развития флота и коммерческой эксплуатации" : model.directorate;
  const date = new Date(model.generatedAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  return { title: `Статус текущих задач ${who}`, subtitle: date };
}
