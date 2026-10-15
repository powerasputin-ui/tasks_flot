import { describe, expect, it } from "vitest";
import { isOverdueRow } from "@/lib/overdue";

describe("просрочено — одно правило для таблицы, аналитики и отчёта", () => {
  // 15.10.2026 10:00 по Москве
  const now = new Date("2026-10-15T07:00:00Z");
  const row = (deadline: string | null, o: { statusName?: string; statusColumn?: string; archived?: boolean } = {}) => ({ deadline: deadline ? `${deadline}T00:00:00.000Z` : null, ...o });

  it("в сам день срока — ещё не просрочено, со следующего дня — просрочено", () => {
    expect(isOverdueRow(row("2026-10-15"), now)).toBe(false);
    expect(isOverdueRow(row("2026-10-14"), now)).toBe(true);
    expect(isOverdueRow(row(null), now)).toBe(false);
  });

  it("закрытые — по названию статуса и по колонке трекера; удалённые — нет", () => {
    expect(isOverdueRow(row("2026-10-01", { statusName: "Завершено" }), now)).toBe(false);
    expect(isOverdueRow(row("2026-10-01", { statusName: "Принято", statusColumn: "DONE" }), now)).toBe(false);
    expect(isOverdueRow(row("2026-10-01", { statusColumn: "HIDDEN" }), now)).toBe(false);
    expect(isOverdueRow(row("2026-10-01", { statusColumn: "REVIEW" }), now)).toBe(true);
    expect(isOverdueRow(row("2026-10-01", { archived: true }), now)).toBe(false);
  });

  it("день — по Москве: 22:30 UTC 14.10 — это уже 15.10, срок 14.10 просрочен", () => {
    expect(isOverdueRow(row("2026-10-14"), new Date("2026-10-14T22:30:00Z"))).toBe(true);
    expect(isOverdueRow(row("2026-10-14"), new Date("2026-10-14T20:30:00Z"))).toBe(false);
  });
});
