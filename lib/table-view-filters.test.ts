import { describe, expect, it } from "vitest";
import { applyTableFilters, applyTableSort, type TableRow } from "@/lib/table-view";

function row(overrides: Partial<TableRow>): TableRow {
  return {
    id: "1",
    segmentId: "seg-1",
    segmentName: "Танкерный флот",
    trackId: "track-1",
    trackName: "Track",
    name: "Позиция",
    cost: null,
    attractivenessId: null,
    attractivenessName: null,
    attractivenessColor: null,
    ownerId: null,
    ownerName: null,
    deadline: null,
    deadlineWeek: null,
    statusId: "status-1",
    statusName: "В работе",
    statusColor: "#2563EB",
    operFlag: false,
    comment: null,
    version: 1,
    createdByName: "Иванов",
    updatedAt: new Date("2026-01-01"),
    staleWeeks: 0,
    archived: false,
    ...overrides,
  };
}

describe("applyTableFilters", () => {
  it("фильтрует по operFlag (отправлено куратору)", () => {
    const rows = [row({ id: "1", operFlag: true }), row({ id: "2", operFlag: false })];
    expect(applyTableFilters(rows, { operFlag: true })).toHaveLength(1);
  });

  it("фильтрует по неделе deadline, не по updatedAt (раздел 14/105 п.7 ТЗ v3)", () => {
    const rows = [row({ id: "1", deadlineWeek: 32 }), row({ id: "2", deadlineWeek: 26 })];
    expect(applyTableFilters(rows, { week: 32 })).toHaveLength(1);
  });

  it("фильтр по нескольким сегментам, none — позиции без сегмента", () => {
    const rows = [row({ id: "1", segmentId: "s1" }), row({ id: "2", segmentId: null }), row({ id: "3", segmentId: "s2" })];
    expect(applyTableFilters(rows, { segmentIds: ["s1"] }).map((r) => r.id)).toEqual(["1"]);
    expect(applyTableFilters(rows, { segmentIds: ["s1", "s2"] }).map((r) => r.id)).toEqual(["1", "3"]);
    expect(applyTableFilters(rows, { segmentIds: ["none"] }).map((r) => r.id)).toEqual(["2"]);
    expect(applyTableFilters(rows, { segmentIds: [] })).toHaveLength(3);
  });

  it("поиск q ищет по названию, комментарию, треку и ответственному без учёта регистра", () => {
    const rows = [
      row({ id: "1", name: "Переговоры с судовладельцем" }),
      row({ id: "2", comment: "Ждём КП" }),
      row({ id: "3", ownerName: "Сухов В.А." }),
      row({ id: "4" }),
    ];
    expect(applyTableFilters(rows, { q: "СУДОВЛАДЕЛЬЦЕМ" }).map((r) => r.id)).toEqual(["1"]);
    expect(applyTableFilters(rows, { q: "кп" }).map((r) => r.id)).toEqual(["2"]);
    expect(applyTableFilters(rows, { q: "сухов" }).map((r) => r.id)).toEqual(["3"]);
  });

  it("диапазон срока исключает строки без срока", () => {
    const rows = [row({ id: "1", deadline: new Date("2026-05-01") }), row({ id: "2", deadline: null })];
    expect(applyTableFilters(rows, { deadlineFrom: new Date("2026-01-01") }).map((r) => r.id)).toEqual(["1"]);
  });
});

describe("applyTableSort", () => {
  it("сортирует по дате последнего обновления", () => {
    const rows = [row({ id: "1", updatedAt: new Date("2026-08-01") }), row({ id: "2", updatedAt: new Date("2026-01-01") })];
    expect(applyTableSort(rows, { sortBy: "updatedAt", sortDir: "asc" }).map((r) => r.id)).toEqual(["2", "1"]);
  });

  it("сортирует по сроку, отправляя пустые сроки в конец", () => {
    const rows = [
      row({ id: "1", deadline: new Date("2026-08-01") }),
      row({ id: "2", deadline: null }),
      row({ id: "3", deadline: new Date("2026-01-01") }),
    ];
    expect(applyTableSort(rows, { sortBy: "deadline", sortDir: "asc" }).map((r) => r.id)).toEqual(["3", "1", "2"]);
  });

  it("сортирует по ответственному", () => {
    const rows = [row({ id: "1", ownerName: "Сухов В.А." }), row({ id: "2", ownerName: "Давыдов Д.М." })];
    expect(applyTableSort(rows, { sortBy: "owner", sortDir: "asc" }).map((r) => r.id)).toEqual(["2", "1"]);
  });
});
