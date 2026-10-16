import { describe, expect, it } from "vitest";
import { directorDigest, isDigestWindowMsk, isMondayMsk, zgdDigest, type DigestItem } from "@/lib/weekly-digest";

const now = new Date("2026-10-19T06:00:00Z"); // понедельник, 09:00 МСК
const it_ = (o: Partial<DigestItem>): DigestItem => ({ id: "x", column: "DOING", kinds: [], blockedBy: null, events: [], ...o });
const ev = (text: string, at: string) => ({ itemId: "x", at, kind: "workflow" as const, who: "Директор", text });

describe("сводка за неделю", () => {
  it("ЗГД: принято за неделю, просрочено, сорван исходный срок, на стопе, ждут ответа; старая приёмка не считается", () => {
    const t = zgdDigest(
      [
        it_({ column: "DONE", events: [ev("принял(а) задачу", "2026-10-16T10:00:00Z")] }),
        it_({ column: "DONE", events: [ev("принял(а) задачу", "2026-09-01T10:00:00Z")] }),
        it_({ kinds: ["overdue", "slipped"] }),
        it_({ blockedBy: "решение ПАО", kinds: ["request"] }),
      ],
      now,
    );
    expect(t).toBe("Сводка за неделю: в работе 2 ваши задачи (поручения и на контроле); принято за неделю — 1; просрочено — 1; исходный срок сорван — 1; на стопе — 1; ждут ответа директора на ваш запрос — 1.");
  });

  it("ЗГД без поручений и контроля — сводки нет", () => {
    expect(zgdDigest([], now)).toBeNull();
  });

  it("директор: приёмка, переносы, запросы ЗГД, стоп дольше недели (свежий стоп — нет), просрочка; нечего решать — сводки нет", () => {
    const t = directorDigest(
      [
        it_({ column: "REVIEW" }),
        it_({ kinds: ["deadlineRequest", "request"] }),
        it_({ blockedBy: "поставка", events: [ev("на стопе: ждём поставка", "2026-10-01T10:00:00Z")] }),
        it_({ blockedBy: "письмо", events: [ev("на стопе: ждём письмо", "2026-10-17T10:00:00Z")] }),
        it_({ kinds: ["overdue"] }),
        it_({ column: "DONE", kinds: ["overdue"] }),
      ],
      now,
    );
    expect(t).toBe("Сводка за неделю: ждут вашей приёмки — 1; просьбы о переносе срока — 1; запросы ЗГД без ответа — 1; на стопе дольше недели — 1; просрочено — 1.");
    expect(directorDigest([it_({})], now)).toBeNull();
  });

  it("понедельник — по Москве", () => {
    expect(isMondayMsk(now)).toBe(true);
    expect(isMondayMsk(new Date("2026-10-18T21:30:00Z"))).toBe(true); // 00:30 МСК понедельника
    expect(isMondayMsk(new Date("2026-10-18T20:30:00Z"))).toBe(false);
  });

  it("окно сводки — понедельник…среда по Москве: упавший понедельничный запуск повторится, в пятницу не шлём", () => {
    expect(["2026-10-19", "2026-10-20", "2026-10-21"].map((d) => isDigestWindowMsk(new Date(`${d}T06:00:00Z`)))).toEqual([true, true, true]);
    expect(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].map((d) => isDigestWindowMsk(new Date(`${d}T06:00:00Z`)))).toEqual([false, false, false, false]);
  });
});
