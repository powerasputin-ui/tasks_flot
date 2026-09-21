import path from "path";
import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";

export type ExportFormat = "csv" | "xlsx" | "pdf";
export type Cell = string | number | null | undefined;

export function parseExportFormat(value: string | null): ExportFormat | null {
  return value === "csv" || value === "xlsx" || value === "pdf" ? value : null;
}

export const EXPORT_CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export type ExportSection = { title: string; headers: string[]; rows: Cell[][] };

const text = (v: Cell) => (v === null || v === undefined ? "" : String(v));

/** BOM + CRLF, чтобы Excel корректно открывал кириллицу. Секции разделяются пустой строкой. */
export function buildCsv(sections: ExportSection[]): string {
  const esc = (v: Cell) => {
    const s = text(v);
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blocks = sections.map((s) =>
    [
      ...(sections.length > 1 ? [esc(s.title)] : []),
      s.headers.map(esc).join(","),
      ...s.rows.map((r) => r.map(esc).join(",")),
    ].join("\r\n")
  );
  return "﻿" + blocks.join("\r\n\r\n");
}

export function buildXlsx(sections: ExportSection[]): Buffer {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const s of sections) {
    const ws = XLSX.utils.aoa_to_sheet([s.headers, ...s.rows.map((r) => r.map((v) => v ?? ""))]);
    let name = s.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Лист";
    while (used.has(name)) name = name.slice(0, 28) + "_" + used.size;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const FONT_REGULAR = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");

export function buildPdf(title: string, subtitle: string | null, sections: ExportSection[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("Body", FONT_REGULAR);
    doc.registerFont("Bold", FONT_BOLD);

    doc.font("Bold").fontSize(16).text(title);
    if (subtitle) doc.font("Body").fontSize(9).fillColor("#666666").text(subtitle).fillColor("#000000");
    doc.moveDown(0.8);

    for (const s of sections) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
      doc.font("Bold").fontSize(12).text(s.title);
      doc.moveDown(0.3);
      drawTable(doc, s.headers, s.rows);
      doc.moveDown(0.8);
    }
    doc.end();
  });
}

function drawTable(doc: PDFKit.PDFDocument, headers: string[], rows: Cell[][]) {
  if (headers.length === 0) return;
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const colW = width / headers.length;
  const bottom = doc.page.height - doc.page.margins.bottom;
  let y = doc.y;

  const drawRow = (cells: string[], bold: boolean) => {
    doc.font(bold ? "Bold" : "Body").fontSize(8);
    const h = Math.max(...cells.map((t) => doc.heightOfString(t, { width: colW - 6 })), 10) + 6;
    if (y + h > bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      doc.font(bold ? "Bold" : "Body").fontSize(8);
    }
    cells.forEach((t, i) => doc.text(t, left + i * colW, y, { width: colW - 6 }));
    y += h;
    doc.moveTo(left, y - 3).lineTo(left + width, y - 3).lineWidth(0.3).strokeColor("#cccccc").stroke();
  };

  drawRow(headers, true);
  if (rows.length === 0) drawRow(["Нет данных", ...headers.slice(1).map(() => "")], false);
  for (const r of rows) drawRow(r.map((v) => (text(v) === "" ? "—" : text(v))), false);
  doc.x = left;
  doc.y = y;
}

export async function renderExport(
  format: ExportFormat,
  opts: { title: string; subtitle?: string; sections: ExportSection[] }
): Promise<Buffer | string> {
  if (format === "csv") return buildCsv(opts.sections);
  if (format === "xlsx") return buildXlsx(opts.sections);
  return buildPdf(opts.title, opts.subtitle ?? null, opts.sections);
}

export function exportResponse(format: ExportFormat, body: Buffer | string, baseName: string): Response {
  const data = typeof body === "string" ? body : new Uint8Array(body);
  return new Response(data, {
    headers: {
      "Content-Type": EXPORT_CONTENT_TYPE[format],
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}.${format}`,
    },
  });
}
