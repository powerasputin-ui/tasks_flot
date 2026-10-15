import { describe, expect, it } from "vitest";
import { buildEvents, columnOf, statusForColumn, summarize, timelineRange, type RawAudit } from "@/lib/tracker";
import { canSetStatus } from "@/lib/permissions";

const names = { status: new Map([["s1", "В работе"], ["s2", "На проверке"]]), user: new Map([["u1", "Майков Т.Г."], ["u2", "Сухов В.А."]]) };
const ev = (p: Partial<RawAudit>): RawAudit => ({ entityId: "i1", action: "UPDATE", fieldName: null, before: null, after: null, timestamp: "2026-10-07T10:00:00.000Z", who: "Майков Т.Г.", ...p });

describe("трекер: колонки", () => {
  const cols = new Map<string, "TODO" | "DOING" | "REVIEW" | "DONE" | "HIDDEN" | null>([["s1", "DOING"], ["s2", "REVIEW"], ["s3", null]]);
  it("колонка по статусу; без статуса и без колонки — «Сделать»", () => {
    expect(columnOf("s1", cols)).toBe("DOING");
    expect(columnOf("s2", cols)).toBe("REVIEW");
    expect(columnOf("s3", cols)).toBe("TODO");
    expect(columnOf(null, cols)).toBe("TODO");
  });
  it("перенос в колонку ставит первый статус этой колонки", () => {
    const st = [{ id: "a", trackerColumn: "TODO" as const }, { id: "b", trackerColumn: "DOING" as const }, { id: "c", trackerColumn: "DOING" as const }];
    expect(statusForColumn("DOING", st)).toBe("b");
    expect(statusForColumn("DONE", st)).toBeNull();
  });
  it("«Выполнено» ставит и снимает только директор/админ", () => {
    expect(canSetStatus("HEAD", "DOING", "REVIEW")).toBe(true);
    expect(canSetStatus("HEAD", "REVIEW", "DONE")).toBe(false);
    expect(canSetStatus("HEAD", "DONE", "DOING")).toBe(false);
    expect(canSetStatus("DIRECTOR", "REVIEW", "DONE")).toBe(true);
    expect(canSetStatus("ADMIN", "DONE", "DOING")).toBe(true);
  });
});

describe("трекер: события", () => {
  it("журнал → понятные события; сдвиг срока позже помечен", () => {
    const e = buildEvents(
      [
        ev({ action: "CREATE" }),
        ev({ action: "STATUS_CHANGE", fieldName: "statusId", before: "s1", after: "s2", timestamp: "2026-10-08T09:00:00.000Z" }),
        ev({ action: "DEADLINE_CHANGE", fieldName: "deadline", before: "2026-10-09T00:00:00.000Z", after: "2026-10-20T00:00:00.000Z", timestamp: "2026-10-09T09:00:00.000Z" }),
        ev({ action: "OPER_FLAG_CHANGE", fieldName: "operFlag", before: "false", after: "true", timestamp: "2026-10-09T10:00:00.000Z" }),
        ev({ action: "OWNER_CHANGE", fieldName: "responsibleId", before: "u1", after: "u2", timestamp: "2026-10-09T11:00:00.000Z" }),
      ],
      [{ at: "2026-10-10T08:00:00.000Z", title: "Справка №3", itemIds: ["i1"] }],
      names,
    );
    expect(e.map((x) => x.text)).toEqual([
      "задача создана",
      "статус: В работе → На проверке",
      "срок: 09.10.26 → 20.10.26 (+11 дн.)",
      "подана в справку",
      "ответственный: Майков Т.Г. → Сухов В.А.",
      "вошла в отправленную справку «Справка №3»",
    ]);
    expect(e[2].slip).toBe(11);
  });
  it("заголовок и комментарий одним сохранением — одно событие", () => {
    const e = buildEvents([ev({ fieldName: "title" }), ev({ fieldName: "comment" })], [], names);
    expect(e).toHaveLength(1);
  });
  it("сводка: сдвиги срока и дни без движения (справка движением не считается)", () => {
    const e = buildEvents(
      [
        ev({ fieldName: "deadline", before: "2026-10-01T00:00:00.000Z", after: "2026-10-05T00:00:00.000Z", timestamp: "2026-10-01T09:00:00.000Z" }),
        ev({ fieldName: "deadline", before: "2026-10-05T00:00:00.000Z", after: "2026-10-12T00:00:00.000Z", timestamp: "2026-10-04T09:00:00.000Z" }),
      ],
      [{ at: "2026-10-10T08:00:00.000Z", title: "С", itemIds: ["i1"] }],
      names,
    );
    expect(summarize(e, new Date("2026-10-14T09:00:00.000Z"))).toEqual({ slips: 2, slipDays: 11, idleDays: 10, lastMoveAt: "2026-10-04T09:00:00.000Z" });
  });
  it("ось: с понедельника самой ранней даты до двух недель после позднего срока", () => {
    const r = timelineRange(["2026-10-08T10:00:00.000Z", "2026-10-30T00:00:00.000Z"], new Date("2026-10-14T00:00:00.000Z"));
    expect(new Date(r.from).toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(new Date(r.to).toISOString().slice(0, 10)).toBe("2026-11-09");
  });
});
