import { describe, it, expect } from "vitest";
import { neutralizeFormula, buildCsv, buildXlsx, buildPdf, parseExportFormat } from "@/lib/export";
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

describe("CSV/Excel-инъекция", () => {
  it("текст, начинающийся с = + - @ , получает апостроф; числа и обычный текст — нет", () => {
    for (const v of ["=HYPERLINK(\"http://evil\")", "+1+1", "-2+3", "@SUM(A1)", String.fromCharCode(9) + "x", String.fromCharCode(13) + "x"]) expect(neutralizeFormula(v)).toBe("'" + v);
    expect(neutralizeFormula("Обычный текст")).toBe("Обычный текст");
    expect(neutralizeFormula(-5)).toBe(-5);
    expect(neutralizeFormula(null)).toBeNull();
  });
  it("в CSV и XLSX опасная ячейка не остаётся формулой", () => {
    const sec = { title: "t", headers: ["=A"], rows: [["=cmd|' /C calc'!A0", "+7 999", 5]] };
    const csv = buildCsv([sec]);
    expect(csv).toContain("'=A");
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+7 999");
    expect(csv).not.toMatch(/(^|,|\n)=/);
  });
});
