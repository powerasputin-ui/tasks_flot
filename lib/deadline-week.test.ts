import { describe, expect, it } from "vitest";
import { deadlineWeek } from "@/lib/deadline-week";

describe("deadlineWeek (раздел 14 ТЗ)", () => {
  it("возвращает null, если deadline не задан", () => {
    expect(deadlineWeek(null)).toBeNull();
    expect(deadlineWeek(undefined)).toBeNull();
  });

  it.each([
    ["2026-05-04", 19],
    ["2026-06-23", 26],
    ["2026-08-06", 32],
  ])("%s -> Week %i (примеры из ТЗ)", (date, week) => {
    expect(deadlineWeek(new Date(date))).toBe(week);
  });
});
