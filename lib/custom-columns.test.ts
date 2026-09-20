import { describe, expect, it } from "vitest";
import { flattenCustom, mergeCustomValues, parseOptions, type ColumnDef } from "@/lib/custom-columns";

const cols: ColumnDef[] = [
  { id: "t", name: "Заметка", type: "TEXT", options: [] },
  { id: "n", name: "Сумма", type: "NUMBER", options: [] },
  { id: "d", name: "Отчёт", type: "DATE", options: [] },
  { id: "s", name: "Приоритет", type: "SELECT", options: ["Высокий", "Низкий"] },
];

describe("mergeCustomValues", () => {
  it("сохраняет допустимые значения и сливает с прежними", () => {
    const r = mergeCustomValues(cols, { t: "старое" }, { n: "12,5", s: "Высокий" });
    expect(r).toEqual({ ok: true, values: { t: "старое", n: "12,5", s: "Высокий" } });
  });

  it("пустая строка убирает значение", () => {
    const r = mergeCustomValues(cols, { t: "x", n: "1" }, { t: "  " });
    expect(r).toEqual({ ok: true, values: { n: "1" } });
  });

  it("проверяет тип: число, дата, значение из списка", () => {
    expect(mergeCustomValues(cols, {}, { n: "abc" }).ok).toBe(false);
    expect(mergeCustomValues(cols, {}, { d: "31.12.2026" }).ok).toBe(false);
    expect(mergeCustomValues(cols, {}, { d: "2026-12-31" }).ok).toBe(true);
    expect(mergeCustomValues(cols, {}, { s: "Средний" }).ok).toBe(false);
  });

  it("отклоняет неизвестные или удалённые колонки", () => {
    expect(mergeCustomValues(cols, {}, { zzz: "1" }).ok).toBe(false);
  });
});

describe("flattenCustom / parseOptions", () => {
  it("значения превращаются в поля custom:<id>", () => {
    expect(flattenCustom({ a: "1", b: "2" })).toEqual({ "custom:a": "1", "custom:b": "2" });
    expect(flattenCustom(null)).toEqual({});
  });

  it("варианты списка разбираются по запятым и строкам, без дублей", () => {
    expect(parseOptions("А, Б\nВ, А")).toEqual(["А", "Б", "В"]);
  });
});
