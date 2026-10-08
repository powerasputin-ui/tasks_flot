import { describe, expect, it } from "vitest";
import { countBySegment, countByTrack, filterBySegments, filterBySegmentsAndTracks, groupBySegment, NO_SEGMENT, toggleSegment, trackPickKey } from "@/lib/segment-counts";

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

describe("треки внутри сегментов (сайдбар)", () => {
  const r = (id: string, segmentId: string | null, trackId: string | null, trackName: string | null = trackId) => ({ id, segmentId, trackId, trackName });
  const rows = [
    r("1", "tank", "gpf", "Танкеры ГПФ"),
    r("2", "tank", "gpf", "Танкеры ГПФ"),
    r("3", "tank", "tug", "Буксиры"),
    r("4", "tank", null),
    r("5", "off", "tid", "Tidebon"),
    r("6", null, "gpf", "Танкеры ГПФ"),
  ];

  it("countByTrack: по убыванию числа, «Без трека» в конце, только треки с позициями", () => {
    const c = countByTrack(rows);
    expect(c.get("tank")!.map((t) => [t.name, t.total])).toEqual([["Танкеры ГПФ", 2], ["Буксиры", 1], ["Без трека", 1]]);
    expect(c.get("off")!.map((t) => t.name)).toEqual(["Tidebon"]);
    expect(c.get(NO_SEGMENT)!.map((t) => t.key)).toEqual([trackPickKey(null, "gpf")]);
  });

  it("ничего не выбрано — все; только сегмент — весь сегмент", () => {
    expect(filterBySegmentsAndTracks(rows, [], []).length).toBe(6);
    expect(filterBySegmentsAndTracks(rows, ["tank"], []).map((x) => x.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("трек в сегменте — только его строки (тот же трек в другом сегменте не попадает)", () => {
    expect(filterBySegmentsAndTracks(rows, ["tank"], [trackPickKey("tank", "gpf")]).map((x) => x.id)).toEqual(["1", "2"]);
    expect(filterBySegmentsAndTracks(rows, [], [trackPickKey("tank", "gpf")]).map((x) => x.id)).toEqual(["1", "2"]);
  });

  it("несколько треков и сегмент без отмеченных треков — вместе", () => {
    const got = filterBySegmentsAndTracks(rows, ["tank", "off"], [trackPickKey("tank", "tug"), trackPickKey("tank", null)]);
    expect(got.map((x) => x.id)).toEqual(["3", "4", "5"]);
  });
});
