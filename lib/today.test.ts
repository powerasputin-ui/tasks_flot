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

  it("просроченная «на стопе» — в «Просрочено» с пометкой у всех ролей (раньше у директора и ЗГД пропадала); без дел — пусто", () => {
    const stopped = row("s", { deadline: "2026-10-01", blockedBy: "документ" });
    const hot = { s: { kinds: ["blocker"] } };
    const asHead = buildToday({ role: "HEAD", meId: "head", rows: [stopped], hot, colOf, now });
    expect(keys(asHead)).toEqual(["overdue"]);
    expect(asHead[0].items[0].note).toBe("просрочено на 15 дн. (срок 01.10.26) · на стопе: ждём документ");
    for (const role of ["DIRECTOR", "EXECUTIVE"]) expect(items(buildToday({ role, meId: "x", rows: [stopped], hot, colOf, now }), "overdue")).toEqual(["s"]);
    // не просроченная «на стопе» — в разделе «На стопе» у руководителя
    expect(keys(buildToday({ role: "HEAD", meId: "head", rows: [row("t", { deadline: "2026-12-01", blockedBy: "виза" })], hot: {}, colOf, now }))).toEqual(["stopped"]);
    expect(buildToday({ role: "HEAD", meId: "head", rows: [row("ok", { deadline: "2026-12-30" })], hot: {}, colOf, now })).toEqual([]);
  });

  it("раздел отсортирован по сроку, без срока — в конце", () => {
    const rows = [row("late", { deadline: "2026-10-18" }), row("none", { statusId: "review" }), row("early", { deadline: "2026-10-16" })];
    const s = buildToday({ role: "HEAD", meId: "head", rows, hot: {}, colOf, now });
    expect(items(s, "soon")).toEqual(["early", "late"]);
  });

  it("задача — в одном разделе (самом важном для роли), остальное о ней — в пояснении", () => {
    // директор: сдана, просрочена и ЗГД ждёт ответа — только в «Ждут вашего решения»
    const r = row("r", { statusId: "review", deadline: "2026-10-14", openRequest: true });
    const asDir = buildToday({ role: "DIRECTOR", meId: "dir", rows: [r], hot: {}, colOf, now });
    expect(keys(asDir)).toEqual(["review"]);
    expect(asDir[0].items[0].note).toBe("сдана на проверку · просрочено на 2 дн. (срок 14.10.26) · ЗГД ждёт ответа");
    // руководитель: сданная со сроком завтра — в «Срок скоро», с пометкой, что ждёт директора
    const asHead = buildToday({ role: "HEAD", meId: "head", rows: [row("s", { statusId: "review", deadline: "2026-10-17" })], hot: {}, colOf, now });
    expect(keys(asHead)).toEqual(["soon"]);
    expect(asHead[0].items[0].note).toBe("срок через 1 дн. (17.10.26) · сдана — ждёт директора");
  });

  it("руководитель: «Вернули на доработку» — с замечанием и кто вернул, пока задачу снова не сдали", () => {
    const ev = (itemId: string, at: string, text: string) => ({ itemId, at, kind: "workflow", who: "Дмитриев Д.Д.", text });
    const events = [
      ev("back", "2026-10-15T10:00:00Z", "сдана на проверку: отчёт"),
      ev("back", "2026-10-16T08:00:00Z", "возвращена на доработку: нет данных за сентябрь"),
      ev("again", "2026-10-14T10:00:00Z", "возвращена на доработку: мало"),
      ev("again", "2026-10-15T12:00:00Z", "сдана на проверку: дополнил"),
    ];
    const rows = [row("back", { deadline: "2026-10-15" }), row("again", { statusId: "review" })];
    const s = buildToday({ role: "HEAD", meId: "head", rows, hot: {}, colOf, now, events });
    expect(keys(s)).toEqual(["returned", "review"]);
    expect(s[0].items[0].note).toBe("вернул(а) Дмитриев Д.Д. 16.10.26: нет данных за сентябрь · просрочено на 1 дн. (срок 15.10.26)");
    expect(items(s, "review")).toEqual(["again"]);
  });

  it("руководитель: поручения, которые ещё не начаты; директор: поручение без ответственного", () => {
    const rows = [
      row("new", { origin: "DIRECTOR", assignedByName: "Дмитриев Д.Д.", statusId: "todo" }),
      row("going", { origin: "DIRECTOR", statusId: "work" }),
      row("zgd", { origin: "ZGD", assignedByName: "Зайцев З.З.", ownerId: null, ownerName: null, statusId: "todo" }),
    ];
    const asHead = buildToday({ role: "HEAD", meId: "head", rows, hot: {}, colOf, now });
    expect(keys(asHead)).toEqual(["orders"]);
    expect(asHead[0].items.map((i) => [i.id, i.note])).toEqual([["new", "поручение директора (Дмитриев Д.Д.)"]]);
    const asDir = buildToday({ role: "DIRECTOR", meId: "dir", rows, hot: {}, colOf, now });
    expect(keys(asDir)).toEqual(["unassigned"]);
    expect(asDir[0].items.map((i) => [i.id, i.note])).toEqual([["zgd", "поручение ЗГД (Зайцев З.З.)"]]);
  });

  it("ЗГД видит, из какой дирекции задача; у директора дирекции нет — она одна", () => {
    const rows = [row("a", { deadline: "2026-10-10", directorateName: "Флот" })];
    expect(buildToday({ role: "EXECUTIVE", meId: "zgd", rows, hot: {}, colOf, now })[0].items[0].directorate).toBe("Флот");
    expect(buildToday({ role: "DIRECTOR", meId: "dir", rows, hot: {}, colOf, now })[0].items[0]).not.toHaveProperty("directorate");
  });
});
