import { describe, expect, it } from "vitest";
import { applyTableFilters, applyTableSort, type TableRow } from "@/lib/table-view";

function row(overrides: Partial<TableRow>): TableRow {
  return {
    id: "1",
    type: "TASK",
    segmentId: "seg-1",
    segmentName: "Танкерный флот",
    trackId: "track-1",
    trackName: "Track",
    name: "Task",
    attractivenessId: null,
    attractivenessName: null,
    ownerId: null,
    ownerName: null,
    deadline: null,
    deadlineWeek: null,
    statusId: "status-1",
    statusName: "В работе",
    operFlag: false,
    comment: null,
    ...overrides,
  };
}

describe("applyTableFilters (раздел 41 ТЗ)", () => {
  it("фильтрует по operFlag", () => {
    const rows = [row({ id: "1", operFlag: true }), row({ id: "2", operFlag: false })];
    expect(applyTableFilters(rows, { operFlag: true })).toHaveLength(1);
  });

  it("фильтрует по неделе deadline, не по updatedAt (раздел 14/105 п.7)", () => {
    const rows = [row({ id: "1", deadlineWeek: 32 }), row({ id: "2", deadlineWeek: 26 })];
    expect(applyTableFilters(rows, { week: 32 })).toHaveLength(1);
  });

  it("фильтрует по типу записи", () => {
    const rows = [row({ id: "1", type: "TRACK" }), row({ id: "2", type: "TASK" })];
    expect(applyTableFilters(rows, { type: "TASK" })).toHaveLength(1);
  });
});

describe("applyTableSort (раздел 42 ТЗ)", () => {
  it("сортирует по сроку, отправляя пустые сроки в конец", () => {
    const rows = [
      row({ id: "1", deadline: new Date("2026-08-01") }),
      row({ id: "2", deadline: null }),
      row({ id: "3", deadline: new Date("2026-01-01") }),
    ];
    const sorted = applyTableSort(rows, { sortBy: "deadline", sortDir: "asc" });
    expect(sorted.map((r) => r.id)).toEqual(["3", "1", "2"]);
  });
});
