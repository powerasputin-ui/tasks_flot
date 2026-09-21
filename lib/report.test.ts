import { describe, expect, it } from "vitest";
import { buildFinalModel, buildReport, isOverdue, snapshotToRows, type ReportContext } from "@/lib/report";
import { reportToSections } from "@/lib/report-export";
import { SYSTEM_TEMPLATES, reportConfigSchema, type ReportConfig } from "@/lib/report-config";
import type { TableRow } from "@/lib/table-view";

const NOW = new Date("2026-09-21T12:00:00Z");
const ctx: ReportContext = { directorate: "Дирекция X", generatedAt: NOW, customColumns: [{ id: "c1", name: "Приоритет", type: "SELECT" }], now: NOW };

function row(o: Partial<TableRow>): TableRow {
  return {
    id: "1",
    segmentId: "s1",
    segmentName: "Крупнотоннажные перевозки",
    trackId: "t1",
    trackName: "Бункеровщики",
    name: "Задача",
    cost: null,
    attractivenessId: null,
    attractivenessName: null,
    attractivenessColor: null,
    ownerId: "u1",
    ownerName: "Сухов В.А.",
    ownerRole: null,
    deadline: null,
    deadlineWeek: null,
    statusId: "st1",
    statusName: "В работе",
    statusColor: "#2563EB",
    operFlag: false,
    comment: null,
    version: 1,
    createdById: "u",
    changedAfterSubmission: false,
    customValues: {},
    createdByName: "Иванов",
    updatedAt: new Date("2026-09-01"),
    staleWeeks: 0,
    archived: false,
    ...o,
  };
}

const base: ReportConfig = { columns: ["name", "owner", "status", "deadline", "comment"], groupBy: ["segment", "track"] };

describe("buildReport: сводка", () => {
  it("считает всего, по статусам (в порядке убывания), просрочено и отправлено", () => {
    const rows = [
      row({ id: "1", statusName: "В работе", deadline: new Date("2026-09-01"), operFlag: true }), // просрочена
      row({ id: "2", statusName: "В работе", deadline: new Date("2026-12-01") }),
      row({ id: "3", statusName: "Завершено", statusId: "st2", statusColor: "#16a34a", deadline: new Date("2026-01-01") }), // завершена — не просрочена
    ];
    const m = buildReport(rows, base, ctx);
    expect(m.summary.total).toBe(3);
    expect(m.summary.byStatus.map((s) => [s.name, s.count])).toEqual([["В работе", 2], ["Завершено", 1]]);
    expect(m.summary.overdue).toBe(1);
    expect(m.summary.sent).toBe(1);
  });

  it("привлекательность: код и пояснение, от высокой к низкой; пустая = P0", () => {
    const rows = [row({ id: "1", attractivenessName: "P10" }), row({ id: "2", attractivenessName: "P100" }), row({ id: "3" })];
    const m = buildReport(rows, base, ctx);
    expect(m.summary.byAttractiveness.map((a) => a.name)).toEqual(["P100", "P10", "P0"]);
    expect(m.summary.byAttractiveness[0].label).toBe("Высокая");
  });

  it("isOverdue: без дедлайна, в архиве и завершённые не просрочены", () => {
    expect(isOverdue({ deadline: null, statusName: "В работе", archived: false }, NOW)).toBe(false);
    expect(isOverdue({ deadline: new Date("2020-01-01"), statusName: "В работе", archived: true }, NOW)).toBe(false);
    expect(isOverdue({ deadline: new Date("2020-01-01"), statusName: "Не актуально", archived: false }, NOW)).toBe(false);
    expect(isOverdue({ deadline: new Date("2020-01-01"), statusName: "В работе", archived: false }, NOW)).toBe(true);
  });
});

describe("buildReport: группировка Сегмент → Трек", () => {
  const rows = [
    row({ id: "1", segmentId: "s1", segmentName: "Крупнотоннажные", trackId: "t1", trackName: "Бункеровщики" }),
    row({ id: "2", segmentId: "s1", segmentName: "Крупнотоннажные", trackId: "t2", trackName: "Танкеры" }),
    row({ id: "3", segmentId: "s2", segmentName: "Балкеры", trackId: "t3", trackName: "Ледокол" }),
    row({ id: "4", segmentId: null, segmentName: null, trackId: null, trackName: null }),
  ];

  it("строит дерево, группы по алфавиту, «без …» в конце, с числами", () => {
    const m = buildReport(rows, base, ctx);
    expect(m.groups!.map((g) => [g.label, g.count])).toEqual([["Балкеры", 1], ["Крупнотоннажные", 2], ["Без сегмента", 1]]);
    const big = m.groups!.find((g) => g.label === "Крупнотоннажные")!;
    expect(big.groups!.map((g) => g.label)).toEqual(["Бункеровщики", "Танкеры"]);
    expect(big.groups![0].rows).toHaveLength(1);
    expect(m.rows).toBeNull();
  });

  it("колонки, ставшие группами, из таблицы убираются", () => {
    const m = buildReport(rows, { ...base, columns: ["segment", "track", "name", "status"] }, ctx);
    expect(m.columns.map((c) => c.key)).toEqual(["name", "status"]);
  });

  it("без группировки — плоский список", () => {
    const m = buildReport(rows, { ...base, groupBy: [], columns: ["segment", "name"] }, ctx);
    expect(m.groups).toBeNull();
    expect(m.rows).toHaveLength(4);
    expect(m.columns.map((c) => c.key)).toEqual(["segment", "name"]);
  });

  it("итоги по статусам считаются в каждой группе", () => {
    const m = buildReport([row({ id: "1" }), row({ id: "2", statusName: "Завершено", statusId: "s9" })], base, ctx);
    expect(m.groups![0].byStatus.map((s) => s.count)).toEqual([1, 1]);
  });
});

describe("buildReport: фильтры, сортировка, комментарии, свои колонки", () => {
  it("фильтры: статус, только отправленные, только просроченные", () => {
    const rows = [
      row({ id: "1", statusId: "a", operFlag: true, deadline: new Date("2026-01-01") }),
      row({ id: "2", statusId: "b", operFlag: false, deadline: new Date("2027-01-01") }),
    ];
    expect(buildReport(rows, { ...base, groupBy: [], filters: { statusIds: ["a"] } }, ctx).rows!.map((r) => r.id)).toEqual(["1"]);
    expect(buildReport(rows, { ...base, groupBy: [], filters: { sentOnly: true } }, ctx).rows!.map((r) => r.id)).toEqual(["1"]);
    expect(buildReport(rows, { ...base, groupBy: [], filters: { overdueOnly: true } }, ctx).rows!.map((r) => r.id)).toEqual(["1"]);
    expect(buildReport(rows, { ...base, groupBy: [], filters: { statusIds: ["zzz"] } }, ctx).rows).toEqual([]);
  });

  it("сортировка по дедлайну: пустые внизу при любом направлении", () => {
    const rows = [row({ id: "1", deadline: new Date("2026-12-01") }), row({ id: "2", deadline: null }), row({ id: "3", deadline: new Date("2026-10-01") })];
    const asc = buildReport(rows, { ...base, groupBy: [], sort: { by: "deadline", dir: "asc" } }, ctx).rows!.map((r) => r.id);
    const desc = buildReport(rows, { ...base, groupBy: [], sort: { by: "deadline", dir: "desc" } }, ctx).rows!.map((r) => r.id);
    expect(asc).toEqual(["3", "1", "2"]);
    expect(desc).toEqual(["1", "3", "2"]);
  });

  it("режимы комментариев: под задачей, колонкой, скрыть", () => {
    const rows = [row({ id: "1", comment: "ждём КП" })];
    const under = buildReport(rows, { ...base, options: { comments: "underTask" } }, ctx);
    expect(under.columns.some((c) => c.key === "comment")).toBe(false);
    expect(under.groups![0].groups![0].rows![0].comment).toBe("ждём КП");
    const col = buildReport(rows, { ...base, options: { comments: "column" } }, ctx);
    expect(col.columns.some((c) => c.key === "comment")).toBe(true);
    expect(col.groups![0].groups![0].rows![0].comment).toBeNull();
    const hide = buildReport(rows, { ...base, options: { comments: "hide" } }, ctx);
    expect(hide.columns.some((c) => c.key === "comment")).toBe(false);
    expect(hide.groups![0].groups![0].rows![0].comment).toBeNull();
  });

  it("свои колонки выводятся; удалённые (нет в справочнике) отбрасываются", () => {
    const rows = [row({ id: "1", customValues: { c1: "Срочно" } })];
    const m = buildReport(rows, { ...base, groupBy: [], columns: ["name", "custom:c1", "custom:gone"] }, ctx);
    expect(m.columns.map((c) => c.label)).toEqual(["Задача", "Приоритет"]);
    expect(m.rows![0].cells["custom:c1"]).toBe("Срочно");
  });

  it("пустые данные не ломают отчёт", () => {
    const m = buildReport([], base, ctx);
    expect(m.summary.total).toBe(0);
    expect(m.groups).toEqual([]);
  });

  it("группировка по ответственному и статусу", () => {
    const rows = [row({ id: "1", ownerId: "u1", ownerName: "Сухов" }), row({ id: "2", ownerId: "u2", ownerName: "Давыдов", statusName: "Завершено", statusId: "x" })];
    const byOwner = buildReport(rows, { ...base, groupBy: ["owner"] }, ctx);
    expect(byOwner.groups!.map((g) => g.label)).toEqual(["Давыдов", "Сухов"]);
    const byStatus = buildReport(rows, { ...base, groupBy: ["status"] }, ctx);
    expect(byStatus.groups!.map((g) => g.label).sort()).toEqual(["В работе", "Завершено"]);
  });
});

describe("конфигурация и шаблоны из коробки", () => {
  it("шаблоны из коробки проходят проверку схемы", () => {
    for (const t of SYSTEM_TEMPLATES) expect(reportConfigSchema.safeParse(t.config).success).toBe(true);
  });

  it("схема отклоняет пустые колонки, неизвестную группировку и лишние уровни", () => {
    expect(reportConfigSchema.safeParse({ columns: [], groupBy: [] }).success).toBe(false);
    expect(reportConfigSchema.safeParse({ columns: ["name"], groupBy: ["nope"] }).success).toBe(false);
    expect(reportConfigSchema.safeParse({ columns: ["name"], groupBy: ["segment", "track", "owner", "status"] }).success).toBe(false);
  });
});

describe("отчёт по финальному снимку", () => {
  const snapshot = [
    { ...row({ id: "1", segmentName: "Балкеры", comment: "ждём" }), deadline: "2026-10-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", customFields: [{ name: "Приоритет", type: "SELECT", value: "Срочно" }] },
    { ...row({ id: "2", segmentName: "Балкеры", trackName: "Ледокол" }), deadline: null, updatedAt: "2026-09-02T00:00:00.000Z", customFields: [{ name: "Приоритет", type: "SELECT", value: null }] },
  ];
  const cycle = { snapshot, finalizedAt: new Date("2026-09-20T10:00:00Z"), number: 3 };

  it("строки снимка (даты строками) строятся в отчёт; заголовок по умолчанию — «Оперативка №N»", () => {
    const m = buildFinalModel(cycle, base, "Дирекция X");
    expect(m.title).toBe("Оперативка №3");
    expect(m.summary.total).toBe(2);
    expect(m.generatedAt).toBe("2026-09-20T10:00:00.000Z");
    expect(m.groups![0].label).toBe("Балкеры");
  });

  it("свои колонки берутся из снимка под их названиями, а не из текущего справочника", () => {
    const m = buildFinalModel(cycle, { ...base, groupBy: [], columns: ["name", "custom:qq-удалена"] }, "Дирекция X");
    expect(m.columns.map((c) => c.label)).toEqual(["Задача", "Приоритет"]);
    expect(m.rows![0].cells["custom:f0"]).toBe("Срочно");
    expect(m.rows![1].cells["custom:f0"]).toBe("—");
  });

  it("пустой или повреждённый снимок не ломает отчёт", () => {
    expect(buildFinalModel({ snapshot: null, finalizedAt: null, number: 1 }, base, "Д").summary.total).toBe(0);
    expect(snapshotToRows("мусор").rows).toEqual([]);
  });
});

describe("колонки, целиком ушедшие в группировку", () => {
  it("лишних колонок не добавляется: выбранных нет — строк задач нет", () => {
    const m = buildReport([row({ id: "1" })], { columns: ["segment", "track"], groupBy: ["segment", "track"] }, ctx);
    expect(m.columns).toEqual([]);
    expect(m.groups![0].count).toBe(1);
  });

  it("снятая колонка «Задача» не попадает в модель", () => {
    const m = buildReport([row({ id: "1" })], { columns: ["owner", "status"], groupBy: [] }, ctx);
    expect(m.columns.map((c) => c.key)).toEqual(["owner", "status"]);
    expect(Object.keys(m.rows![0].cells)).toEqual(["owner", "status"]);
  });
});

describe("комментарии: выбраны в колонках + режим", () => {
  const rows = [row({ id: "1", comment: "ждём КП" })];

  it("под задачей — без колонки; колонкой — на своём месте; не показывать — нигде", () => {
    const cols = ["name", "comment", "owner"];
    const under = buildReport(rows, { columns: cols, groupBy: [], options: { comments: "underTask" } }, ctx);
    expect(under.columns.map((c) => c.key)).toEqual(["name", "owner"]);
    expect(under.rows![0].comment).toBe("ждём КП");
    const col = buildReport(rows, { columns: cols, groupBy: [], options: { comments: "column" } }, ctx);
    expect(col.columns.map((c) => c.key)).toEqual(["name", "comment", "owner"]);
    expect(col.rows![0].cells.comment).toBe("ждём КП");
    expect(col.rows![0].comment).toBeNull();
    const hide = buildReport(rows, { columns: cols, groupBy: [], options: { comments: "hide" } }, ctx);
    expect(hide.columns.map((c) => c.key)).toEqual(["name", "owner"]);
    expect(hide.rows![0].comment).toBeNull();
  });

  it("«Комментарий» не выбран в колонках — комментариев нет ни колонкой, ни под задачей", () => {
    for (const comments of ["underTask", "column"] as const) {
      const m = buildReport(rows, { columns: ["name", "owner"], groupBy: [], options: { comments } }, ctx);
      expect(m.columns.map((c) => c.key)).toEqual(["name", "owner"]);
      expect(m.rows![0].comment).toBeNull();
    }
  });

  it("без остальных колонок, но с комментарием под задачей комментарии не теряются", () => {
    const m = buildReport(rows, { columns: ["segment", "comment"], groupBy: ["segment"], options: { comments: "underTask" } }, ctx);
    expect(m.columns).toEqual([]);
    expect(m.groups![0].rows![0].comment).toBe("ждём КП");
    expect(JSON.stringify(reportToSections(m, { summary: false }))).toContain("ждём КП");
  });
});
