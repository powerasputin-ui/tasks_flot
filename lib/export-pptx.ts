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
