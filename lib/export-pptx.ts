import PptxGenJS from "pptxgenjs";
import type { ReportData } from "@/lib/report-data";

const ROWS_PER_SLIDE = 8;
const MAX_COLS_FONT = 10;

/** PPTX Renderer (раздел 56): только отрисовка ReportData, без бизнес-логики. */
export async function renderPptx(report: ReportData): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = report.title;

  const cover = pptx.addSlide();
  cover.addText(report.title, { x: 0.6, y: 2.4, w: 12, h: 1, fontSize: 36, bold: true, fontFace: "Arial" });
  cover.addText(report.subtitle, { x: 0.6, y: 3.5, w: 12, h: 0.5, fontSize: 16, color: "666666", fontFace: "Arial" });

  for (const section of report.sections) {
    const pages = Math.max(1, Math.ceil(section.rows.length / ROWS_PER_SLIDE));
    for (let p = 0; p < pages; p++) {
      const slide = pptx.addSlide();
      slide.addText(pages > 1 ? `${section.title} (${p + 1}/${pages})` : section.title, {
        x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 24, bold: true, fontFace: "Arial",
      });
      const rows = section.rows.slice(p * ROWS_PER_SLIDE, (p + 1) * ROWS_PER_SLIDE);
      if (rows.length === 0) {
        slide.addText("Нет данных.", { x: 0.5, y: 1.2, w: 12, h: 0.5, fontSize: 14, color: "888888", fontFace: "Arial" });
        continue;
      }
      const cell = (text: string, header: boolean) => ({
        text,
        options: {
          bold: header,
          fontSize: MAX_COLS_FONT,
          fontFace: "Arial",
          fill: header ? { color: "F0F0F0" } : undefined,
          border: { type: "solid" as const, color: "DDDDDD", pt: 0.5 },
        },
      });
      slide.addTable(
        [
          section.headers.map((h) => cell(h, true)),
          ...rows.map((r) => r.map((v) => cell(v === null || v === undefined || v === "" ? "—" : String(v), false))),
        ],
        { x: 0.5, y: 1.1, w: 12.3, autoPage: false }
      );
    }
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}

/** PowerPoint из модели отчёта: титул, сводка, затем слайды по верхним группам (сегментам): таблица позиций с подгруппами. */
export async function renderReportPptx(model: import("@/lib/report").ReportModel): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = model.directorate;
  const font = "Arial";
  const fmt = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const cover = pptx.addSlide();
  cover.addText(model.directorate, { x: 0.6, y: 2.3, w: 12, h: 1.4, fontSize: 32, bold: true, fontFace: font });
  cover.addText(`${model.title} · сформировано ${fmt(model.generatedAt)}`, { x: 0.6, y: 3.9, w: 12, h: 0.5, fontSize: 16, color: "666666", fontFace: font });

  const cell = (text: string, header = false, colspan?: number) => ({
    text,
    options: {
      bold: header,
      fontSize: MAX_COLS_FONT,
      fontFace: font,
      fill: header ? { color: "F0F0F0" } : undefined,
      border: { type: "solid" as const, color: "DDDDDD", pt: 0.5 },
      ...(colspan ? { colspan } : {}),
    },
  });

  if (model.showSummary) {
    const s = model.summary;
    const slide = pptx.addSlide();
    slide.addText("Статус текущих задач", { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 24, bold: true, fontFace: font });
    slide.addTable(
      [
        [cell("Показатель", true), cell("Количество", true)],
        [cell("Всего задач"), cell(String(s.total))],
        ...s.byStatus.map((st) => [cell(st.name), cell(String(st.count))]),
        [cell("Просрочено"), cell(String(s.overdue))],
        [cell("Отправлено директору"), cell(String(s.sent))],
      ],
      { x: 0.5, y: 1.1, w: 6, autoPage: false }
    );
  }

  // Все листья дерева с подписями вложенных уровней (для верхней группы — начиная со второго уровня).
  type Leaf = { path: string[]; row: import("@/lib/report").ReportRow };
  const leaves = (groups: import("@/lib/report").ReportGroup[], path: string[]): Leaf[] =>
    groups.flatMap((g) => (g.groups ? leaves(g.groups, [...path, g.label]) : (g.rows ?? []).map((row) => ({ path: [...path, g.label], row }))));

  const topGroups = model.groups ?? [{ key: "all", level: "segment" as const, label: model.title, count: model.summary.total, byStatus: [], rows: model.rows ?? [] }];
  for (const g of topGroups) {
    const list = g.groups ? leaves(g.groups, []) : (g.rows ?? []).map((row) => ({ path: [] as string[], row }));
    const depth = list[0]?.path.length ?? 0;
    const headers = [...(depth > 0 ? ["Подгруппа"] : []), ...model.columns.map((c) => c.label)];
    const pages = Math.max(1, Math.ceil(list.length / ROWS_PER_SLIDE));
    for (let p = 0; p < pages; p++) {
      const slide = pptx.addSlide();
      slide.addText(`${g.label} (${g.count})${pages > 1 ? ` — ${p + 1}/${pages}` : ""}`, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 22, bold: true, fontFace: font });
      const chunk = list.slice(p * ROWS_PER_SLIDE, (p + 1) * ROWS_PER_SLIDE);
      if (model.columns.length === 0) continue; // колонок не выбрано — на слайде только название группы
      if (chunk.length === 0) {
        slide.addText("Нет данных.", { x: 0.5, y: 1.2, w: 12, h: 0.5, fontSize: 14, color: "888888", fontFace: font });
        continue;
      }
      const body = chunk.flatMap(({ path, row }) => {
        const main = [...(depth > 0 ? [cell(path.join(" / "))] : []), ...model.columns.map((c) => cell(row.cells[c.key] ?? "—"))];
        return [main];
      });
      slide.addTable([headers.map((h) => cell(h, true)), ...body], { x: 0.5, y: 1.1, w: 12.3, autoPage: false });
    }
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
