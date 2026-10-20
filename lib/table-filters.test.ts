import { describe, expect, it } from "vitest";
import { normalizeShownFilters, tableFiltersKey } from "@/lib/table-filters";

describe("фильтры в ряду таблицы: личный набор", () => {
  it("только известные ключи, без повторов, в постоянном порядке ряда", () => {
    expect(normalizeShownFilters(["owner", "status", "хак", "status", "week"])).toEqual(["week", "status", "owner"]);
    expect(normalizeShownFilters(["deadline", "archive", "track"])).toEqual(["track", "deadline", "archive"]);
  });
  it("не массив (ничего не настроено, испорченная запись) — пустой набор: в ряду только «+ Фильтры»", () => {
    for (const v of [null, undefined, "status", { status: true }, 5]) expect(normalizeShownFilters(v)).toEqual([]);
  });
  it("у каждого свой ключ настройки", () => {
    expect(tableFiltersKey("u1")).toBe("table.filters:u1");
    expect(tableFiltersKey("u1")).not.toBe(tableFiltersKey("u2"));
  });
});
