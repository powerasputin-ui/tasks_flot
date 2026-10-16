import { describe, expect, it } from "vitest";
import { buildToday, type TodayRow } from "@/lib/today";
import type { TrackerColumnKey } from "@/lib/tracker";

// сегодня по Москве — 16.10.2026
const now = Date.UTC(2026, 9, 16, 9, 0);
const colOf = new Map<string, TrackerColumnKey | null>([
  ["todo", "TODO"],
  ["work", "DOING"],
  ["review", "REVIEW"],
  ["done", "DONE"],
  ["off", "HIDDEN"],
]);
const row = (id: string, o: Partial<TodayRow> = {}): TodayRow => ({ id, name: `задача ${id}`, statusId: "work", statusName: "В работе", deadline: null, ownerId: "head", ownerName: "Руководитель", ...o });
const keys = (s: Array<{ key: string }>) => s.map((x) => x.key);
const items = (s: Array<{ key: string; items: Array<{ id: string }> }>, key: string) => s.find((x) => x.key === key)?.items.map((i) => i.id);

describe("«Мой день»", () => {
  it("руководитель: только свои задачи — просрочено, скоро, на стопе, ждёт директора", () => {
    const rows = [
      row("a", { deadline: "2026-10-12" }), // просрочена
      row("b", { deadline: "2026-10-16" }), // сегодня
      row("c", { deadline: "2026-10-19" }), // через 3 дня
      row("d", { deadline: "2026-10-20" }), // далеко
      row("e", { statusId: "review", statusName: "На проверке" }),
      row("f", { blockedBy: "договор" }),
      row("x", { deadline: "2026-10-10", ownerId: "other" }), // чужая
      row("y", { deadline: "2026-10-10", statusId: "done" }), // выполнена
      row("z", { deadline: "2026-10-10", archived: true }), // удалена
    ];
    const s = buildToday({ role: "HEAD", meId: "head", rows, hot: {}, colOf, now });
    expect(keys(s)).toEqual(["overdue", "soon", "stopped", "review"]);
    expect(items(s, "overdue")).toEqual(["a"]);
    expect(items(s, "soon")).toEqual(["b", "c"]);
    expect(s.find((x) => x.key === "soon")!.items[0].note).toBe("срок сегодня");
    expect(items(s, "stopped")).toEqual(["f"]);
    expect(items(s, "review")).toEqual(["e"]);
    expect(s[0].items[0].note).toMatch(/просрочено на 4 дн\./);
  });

  it("директор: вся дирекция; ждёт решения, запросы ЗГД, просьбы о переносе — раньше просрочки", () => {
    const rows = [row("r", { statusId: "review", ownerId: "h1" }), row("q", { ownerId: "h2" }), row("m", { ownerId: "h3" }), row("o", { deadline: "2026-10-01", ownerId: "h4" })];
    const hot = { q: { kinds: ["request"] }, m: { kinds: ["deadlineRequest"] } };
    const s = buildToday({ role: "DIRECTOR", meId: "dir", rows, hot, colOf, now });
    expect(keys(s)).toEqual(["review", "asked", "moves", "overdue"]);
    expect(items(s, "asked")).toEqual(["q"]);
    expect(items(s, "moves")).toEqual(["m"]);
  });

  it("ЗГД: запросы без ответа, просрочено, его поручения в работе (чужие поручения не попадают)", () => {
    const rows = [row("a", { openRequest: true }), row("b", { deadline: "2026-10-01" }), row("c", { origin: "ZGD", assignedById: "zgd" }), row("d", { origin: "ZGD", assignedById: "someone" }), row("e", { origin: "ZGD", assignedById: "zgd", statusId: "done" })];
    const s = buildToday({ role: "EXECUTIVE", meId: "zgd", rows, hot: {}, colOf, now });
    expect(keys(s)).toEqual(["asked", "overdue", "orders"]);
    expect(items(s, "orders")).toEqual(["c"]);
  });

  it("задача «на стопе» не считается просроченной, а пустые разделы не показываются; без дел — пусто", () => {
    const stopped = row("s", { deadline: "2026-10-01", blockedBy: "документ" });
    expect(keys(buildToday({ role: "HEAD", meId: "head", rows: [stopped], hot: { s: { kinds: ["blocker"] } }, colOf, now }))).toEqual(["stopped"]);
    expect(buildToday({ role: "HEAD", meId: "head", rows: [row("ok", { deadline: "2026-12-30" })], hot: {}, colOf, now })).toEqual([]);
  });

  it("раздел отсортирован по сроку, без срока — в конце", () => {
    const rows = [row("late", { deadline: "2026-10-18" }), row("none", { statusId: "review" }), row("early", { deadline: "2026-10-16" })];
    const s = buildToday({ role: "HEAD", meId: "head", rows, hot: {}, colOf, now });
    expect(items(s, "soon")).toEqual(["early", "late"]);
  });
});
