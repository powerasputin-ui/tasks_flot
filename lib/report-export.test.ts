import { describe, expect, it } from "vitest";
import { buildReport } from "@/lib/report";
import { reportFileHeader, reportPdfHeader, reportToSections } from "@/lib/report-export";
import { SYSTEM_TEMPLATES } from "@/lib/report-config";
import type { TableRow } from "@/lib/table-view";

const NOW = new Date("2026-09-21T12:00:00Z");
const ctx = { directorate: "Дирекция X", generatedAt: NOW, customColumns: [], now: NOW };

function row(o: Partial<TableRow>): TableRow {
  return {
    id: "1", segmentId: "s1", segmentName: "Балкеры", trackId: "t1", trackName: "Ледокол", name: "Задача", cost: null,
    attractivenessId: null, attractivenessName: null, attractivenessColor: null, ownerId: "u1", ownerName: "Сухов В.А.", ownerRole: null,
    deadline: new Date("2026-10-01"), deadlineWeek: null, statusId: "st1", statusName: "В работе", statusColor: "#2563EB", operFlag: false,
    comment: null, version: 1, createdById: "u", changedAfterSubmission: false, customValues: {}, createdByName: "И",
    updatedAt: new Date("2026-09-01"), staleWeeks: 0, archived: false, ...o,
  };
}

describe("reportToSections", () => {
  const rows = [row({ id: "1", comment: "ждём КП" }), row({ id: "2", name: "Вторая", trackId: "t2", trackName: "Танкеры", statusName: "Завершено" })];
  const model = buildReport(rows, SYSTEM_TEMPLATES[0].config, ctx);
  const sections = reportToSections(model);

  it("первая секция — сводка по статусам, вторая — задачи", () => {
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("Статус текущих задач");
    expect(sections[0].rows[0]).toEqual(["Всего задач", 2]);
    expect(sections[0].rows.some((r) => r[0] === "В работе" && r[1] === 1)).toBe(true);
    expect(sections[1].headers).toEqual(model.columns.map((c) => c.label));
  });

  it("группы идут строками с числом позиций, комментарий — строкой под задачей", () => {
    const first = sections[1].rows.map((r) => String(r[0]));
    expect(first.some((t) => t.includes("Сегмент: Балкеры (2)"))).toBe(true);
    expect(first.some((t) => t.includes("Трек: Ледокол (1)"))).toBe(true);
    expect(first.some((t) => t.includes("Комментарий: ждём КП"))).toBe(true);
  });

  it("без сводки и без группировки — один плоский список", () => {
    const flat = reportToSections(buildReport(rows, SYSTEM_TEMPLATES[1].config, ctx));
    expect(flat).toHaveLength(1);
    expect(flat[0].rows).toHaveLength(2);
    expect(String(flat[0].rows[0][0])).not.toContain("Сегмент:");
  });

  it("заголовок файла — дирекция, подзаголовок содержит название отчёта и число позиций", () => {
    const h = reportFileHeader(model);
    expect(h.title).toBe("Дирекция X");
    expect(h.subtitle).toContain("позиций: 2");
  });
});

describe("PDF: шапка и состав", () => {
  const model = buildReport([row({ id: "1" })], SYSTEM_TEMPLATES[0].config, { ...ctx, directorate: "Дирекция по развитию флота и коммерческой эксплуатации" });
  it("название документа и дата, без сводки; таблица называется «Оперативка»", () => {
    const h = reportPdfHeader(model);
    expect(h.title).toBe("Статус текущих задач дирекции развития флота и коммерческой эксплуатации");
    expect(h.subtitle).toBe("21.09.2026");
    const sections = reportToSections(model, { summary: false });
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Оперативка");
  });
});

describe("колонки в файлах", () => {
  it("в файл попадают только выбранные колонки", () => {
    const m = buildReport([row({ id: "1" })], { columns: ["owner", "status"], groupBy: [] }, ctx);
    const s = reportToSections(m, { summary: false });
    expect(s[0].headers).toEqual(["Ответственный", "Статус"]);
    expect(s[0].rows[0]).toHaveLength(2);
  });

  it("если выбранных колонок нет (всё в группировке) — только группы, без строк задач и без падения", () => {
    const m = buildReport([row({ id: "1", name: "СЕКРЕТНАЯ" })], { columns: ["segment"], groupBy: ["segment"] }, ctx);
    const s = reportToSections(m, { summary: false });
    expect(JSON.stringify(s)).not.toContain("СЕКРЕТНАЯ");
    expect(s[0].rows).toHaveLength(1);
  });
});
