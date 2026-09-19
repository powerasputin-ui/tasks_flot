import type { ExportSection } from "@/lib/export";

/**
 * Единый ReportData (TZ_v4, раздел 7): все рендереры (XLSX/PDF/PPTX) получают
 * данные только отсюда. Сборка ReportData из финального снимка оперативки — этап 4.
 */
export type ReportData = {
  title: string;
  subtitle: string;
  sections: ExportSection[];
};
