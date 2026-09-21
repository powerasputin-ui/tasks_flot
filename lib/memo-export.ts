import path from "node:path";
import PDFDocument from "pdfkit";
import { AlignmentType, Document, Packer, Paragraph, TextRun } from "docx";
import { visibleSections, type MemoDoc } from "@/lib/memo";

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

    pdf.font("Body").fontSize(11).text(title, { align: "center" });
    pdf.moveDown(1.6);

    visibleSections(doc).forEach((section, i) => {
      // заголовок раздела не отрывается от первого пункта
      if (pdf.y > pdf.page.height - pdf.page.margins.bottom - 70) pdf.addPage();
      pdf.font("Bold").fontSize(11).text(`${i + 1}. ${section.title}`, { align: "left" });
      pdf.font("Body").fontSize(11);
      for (const b of section.bullets) pdf.text(`• ${b.text.trim()}`, { align: "justify", lineGap: 1.5 });
      pdf.moveDown(1.2);
    });
    pdf.end();
  });
}

export async function renderMemoDocx(title: string, doc: MemoDoc): Promise<Buffer> {
  const font = "Calibri";
  const children: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new TextRun({ text: title, font, size: 22 })] }),
  ];
  visibleSections(doc).forEach((section, i) => {
    children.push(new Paragraph({ keepNext: true, spacing: { before: 200 }, children: [new TextRun({ text: `${i + 1}. ${section.title}`, bold: true, font, size: 22 })] }));
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
