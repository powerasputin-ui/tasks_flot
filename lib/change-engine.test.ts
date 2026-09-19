import { describe, it, expect } from "vitest";
import { periodBounds, diffStates } from "@/lib/change-engine";
import type { HistoricalRow } from "@/lib/time-travel";

const row = (o: Partial<HistoricalRow> = {}): HistoricalRow => ({
  id: "1", type: "TASK", segmentName: "С", trackId: "t", trackName: "Т", name: "Задача", attractivenessName: null,
  ownerName: null, deadline: null, deadlineWeek: null, statusName: "В работе", operFlag: false, cost: null, comment: null, ...o,
});

describe("periodBounds — календарь", () => {
  it("месяц: число дней учитывает длину месяца и високосный год", () => {
    expect(periodBounds("month", new Date(2026, 8, 19)).days).toBe(30); // сентябрь
    expect(periodBounds("month", new Date(2026, 0, 10)).days).toBe(31); // январь
    expect(periodBounds("month", new Date(2026, 1, 10)).days).toBe(28); // февраль
    expect(periodBounds("month", new Date(2028, 1, 10)).days).toBe(29); // февраль високосного
  });

  it("неделя: пн-вс, 7 дней, конец предыдущего периода — за миг до начала", () => {
    const p = periodBounds("week", new Date(2026, 8, 19)); // сб 19.09.2026
    expect(p.start.getDate()).toBe(14);
    expect(p.end.getDate()).toBe(20);
    expect(p.days).toBe(7);
    expect(p.previousEnd.getTime()).toBe(p.start.getTime() - 1);
    expect(p.label).toContain("Неделя 38");
  });

  it("неделя на стыке годов: 01.01.2027 — это неделя 53 ISO-года 2026", () => {
    const p = periodBounds("week", new Date(2027, 0, 1));
    expect(p.label).toContain("Неделя 53 (2026)");
    expect(p.start.getFullYear()).toBe(2026);
    expect(p.end.getFullYear()).toBe(2027);
  });
});

describe("diffStates", () => {
  it("находит добавленные, удалённые и изменённые записи с Было/Стало", () => {
    const before = [row({ id: "a", statusName: "В работе" }), row({ id: "b" })];
    const after = [row({ id: "a", statusName: "Завершено", operFlag: true }), row({ id: "c" })];
    const d = diffStates(before, after);
    expect(d.added.map((r) => r.id)).toEqual(["c"]);
    expect(d.removed.map((r) => r.id)).toEqual(["b"]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].changes).toEqual([
      { field: "Статус", before: "В работе", after: "Завершено" },
      { field: "Опер", before: "нет", after: "да" },
    ]);
  });

  it("без различий — пустой результат", () => {
    const s = [row()];
    expect(diffStates(s, s)).toEqual({ added: [], removed: [], changed: [] });
  });
});
