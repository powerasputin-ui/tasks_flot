import { describe, expect, it } from "vitest";
import { countBySegment, filterBySegment, NO_SEGMENT } from "@/lib/segment-counts";

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

describe("filterBySegment", () => {
  it("all возвращает всё, id — только этот сегмент, NO_SEGMENT — без сегмента", () => {
    expect(filterBySegment(rows, "all")).toHaveLength(4);
    expect(filterBySegment(rows, "a")).toHaveLength(2);
    expect(filterBySegment(rows, NO_SEGMENT)).toHaveLength(1);
    expect(filterBySegment(rows, "zzz")).toHaveLength(0);
  });
});
