import { describe, expect, it } from "vitest";
import { countBySegment, filterBySegments, groupBySegment, NO_SEGMENT, toggleSegment } from "@/lib/segment-counts";

const rows = [
  { segmentId: "a", operFlag: true },
  { segmentId: "a", operFlag: false },
  { segmentId: "b", operFlag: true },
  { segmentId: null, operFlag: false },
];

describe("countBySegment", () => {
  it("считает позиции и отправленные («Опер») по сегментам", () => {
    const c = countBySegment(rows);
    expect(c.get("a")).toEqual({ total: 2, oper: 1 });
    expect(c.get("b")).toEqual({ total: 1, oper: 1 });
  });

  it("позиции без сегмента попадают в ключ NO_SEGMENT", () => {
    expect(countBySegment(rows).get(NO_SEGMENT)).toEqual({ total: 1, oper: 0 });
  });

  it("пустой список даёт пустую карту", () => {
    expect(countBySegment([]).size).toBe(0);
  });
});

describe("filterBySegments (мультивыбор)", () => {
  it("пустой выбор — все строки", () => {
    expect(filterBySegments(rows, [])).toHaveLength(4);
  });

  it("несколько сегментов одновременно", () => {
    expect(filterBySegments(rows, ["a", "b"])).toHaveLength(3);
    expect(filterBySegments(rows, ["b"])).toHaveLength(1);
  });

  it("NO_SEGMENT выбирает позиции без сегмента, его можно комбинировать с обычными", () => {
    expect(filterBySegments(rows, [NO_SEGMENT])).toHaveLength(1);
    expect(filterBySegments(rows, ["a", NO_SEGMENT])).toHaveLength(3);
  });

  it("неизвестный сегмент даёт пустой результат", () => {
    expect(filterBySegments(rows, ["zzz"])).toHaveLength(0);
  });
});

describe("toggleSegment", () => {
  it("добавляет и убирает сегмент, не меняя исходный массив", () => {
    const start = ["a"];
    expect(toggleSegment(start, "b")).toEqual(["a", "b"]);
    expect(toggleSegment(["a", "b"], "a")).toEqual(["b"]);
    expect(start).toEqual(["a"]);
  });
});

describe("groupBySegment", () => {
  it("раскладывает по порядку списка, «без сегмента» в конце, пустые группы пропускает", () => {
    const g = groupBySegment(rows, ["b", "a", "c"]);
    expect(g.map((x) => x.id)).toEqual(["b", "a", NO_SEGMENT]);
    expect(g.find((x) => x.id === "a")!.rows).toHaveLength(2);
  });
});
