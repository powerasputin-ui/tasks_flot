import { describe, it, expect } from "vitest";
import { buildCsv, buildXlsx, buildPdf, parseExportFormat } from "@/lib/export";
import type { ReportData } from "@/lib/report-data";
import { renderPptx } from "@/lib/export-pptx";

const section = { title: "Итог", headers: ["Показатель", "Значение"], rows: [["Треков, в работе", 12], ['С "кавычками"', null]] };

describe("export", () => {
  it("parseExportFormat принимает только csv/xlsx/pdf", () => {
    expect(parseExportFormat("csv")).toBe("csv");
    expect(parseExportFormat("doc")).toBeNull();
    expect(parseExportFormat(null)).toBeNull();
  });

  it("CSV: BOM, CRLF, экранирование запятых и кавычек", () => {
    const csv = buildCsv([section]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")).toEqual(["﻿Показатель,Значение", '"Треков, в работе",12', '"С ""кавычками""",']);
  });

  it("XLSX и PDF — валидные контейнеры", async () => {
    expect(buildXlsx([section]).subarray(0, 2).toString()).toBe("PK");
    expect((await buildPdf("Тест", null, [section])).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("PPTX строится из ReportData", async () => {
    const report: ReportData = { title: "Оперативка №1", subtitle: "14.09 — 20.09", sections: [section] };
    expect((await renderPptx(report)).subarray(0, 2).toString()).toBe("PK");
  });
});
