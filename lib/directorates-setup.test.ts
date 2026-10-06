import { describe, expect, it } from "vitest";
import { remapCustomKeys } from "@/lib/directorate-setup";
import { mskIsoWeek } from "@/lib/deadline-week";
import { needsDirectorate } from "@/lib/permissions";

describe("дирекции: копия структуры, недели, роли", () => {
  it("remapCustomKeys переводит свои столбцы на копии и выбрасывает ссылки на чужие", () => {
    const map = new Map([["old1", "new1"]]);
    const layout = [{ key: "name", label: "Задача" }, { key: "custom:old1", label: "Флаг", width: 120 }, { key: "custom:gone", label: "Нет" }];
    expect(remapCustomKeys(layout, map)).toEqual([{ key: "name", label: "Задача" }, { key: "custom:new1", label: "Флаг", width: 120 }]);
    expect(remapCustomKeys({ fields: ["track", "custom:old1", "custom:gone"] }, map)).toEqual({ fields: ["track", "custom:new1"] });
  });

  it("mskIsoWeek: граница недели по Москве, а не по UTC", () => {
    // воскресенье 23:30 UTC = понедельник 02:30 МСК — уже следующая неделя
    expect(mskIsoWeek(new Date("2026-10-04T23:30:00Z"))).toBe(mskIsoWeek(new Date("2026-10-05T12:00:00Z")));
    expect(mskIsoWeek(new Date("2026-10-04T20:00:00Z"))).not.toBe(mskIsoWeek(new Date("2026-10-05T12:00:00Z")));
    expect(mskIsoWeek(new Date("2026-01-01T12:00:00Z"))).toBe("2026-1");
    expect(mskIsoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-53");
  });

  it("needsDirectorate: руководителю и директору дирекция обязательна, ЗГД и админам — нет", () => {
    expect(needsDirectorate("HEAD")).toBe(true);
    expect(needsDirectorate("DIRECTOR")).toBe(true);
    expect(needsDirectorate("EXECUTIVE")).toBe(false);
    expect(needsDirectorate("ADMIN")).toBe(false);
  });
});
