import path from "node:path";
import PDFDocument from "pdfkit";
import { AlignmentType, Document, Packer, Paragraph, TextRun } from "docx";
import { splitTitleDate, visibleSections, type MemoDoc } from "@/lib/memo";

/**
 * Файлы справки — по образцу заказчика: A4, заголовок по центру, разделы «1. Название» жирным, пункты с маркером «•»,
 * выравнивание по ширине, шрифт Calibri (в PDF — метрически совместимый Carlito из проекта).
 */
const FONT_REGULAR = path.join(process.cwd(), "assets", "fonts", "Carlito-Regular.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "Carlito-Bold.ttf");

export function renderMemoPdf(title: string, doc: MemoDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margins: { top: 62, bottom: 62, left: 62, right: 62 }, info: { Title: title } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.registerFont("Body", FONT_REGULAR);
    pdf.registerFont("Bold", FONT_BOLD);

    // название по центру, дата совещания — отдельной строкой справа
    const head = splitTitleDate(title);
    pdf.font("Body").fontSize(11).text(head.main, { align: "center" });
    if (head.date) pdf.moveDown(0.6).text(head.date, { align: "right" });
    pdf.moveDown(1.6);

    // разделов может не быть вовсе (в «Виде справки» не отмечены ни трек, ни сегмент) — тогда просто список пунктов
    let no = 0;
    visibleSections(doc).forEach((section) => {
      // заголовок раздела не отрывается от первого пункта
      if (pdf.y > pdf.page.height - pdf.page.margins.bottom - 70) pdf.addPage();
      if (section.title.trim()) pdf.font("Bold").fontSize(11).text(`${++no}. ${section.title}`, { align: "left" });
      pdf.font("Body").fontSize(11);
      for (const b of section.bullets) pdf.text(`• ${b.text.trim()}`, { align: "justify", lineGap: 1.5 });
      pdf.moveDown(1.2);
    });
    pdf.end();
  });
}

export async function renderMemoDocx(title: string, doc: MemoDoc): Promise<Buffer> {
  const font = "Calibri";
  const head = splitTitleDate(title);
  const children: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: head.date ? 120 : 360 }, children: [new TextRun({ text: head.main, font, size: 22 })] }),
    ...(head.date ? [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 360 }, children: [new TextRun({ text: head.date, font, size: 22 })] })] : []),
  ];
  let no = 0;
  visibleSections(doc).forEach((section) => {
    if (section.title.trim()) {
      children.push(new Paragraph({ keepNext: true, spacing: { before: 200 }, children: [new TextRun({ text: `${++no}. ${section.title}`, bold: true, font, size: 22 })] }));
    }
    for (const b of section.bullets) {
      children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 20 }, children: [new TextRun({ text: `• ${b.text.trim()}`, font, size: 22 })] }));
    }
  });
  const file = new Document({
    creator: "ГШП Оперативка",
    title,
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  });
  return Packer.toBuffer(file);
}
