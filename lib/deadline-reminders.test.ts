import { describe, expect, it } from "vitest";
import { mskDay, pickDeadlineReminders, type ReminderItem } from "@/lib/deadline-reminders";

const item = (id: string, deadline: string | null, over: Partial<ReminderItem> = {}): ReminderItem => ({
  id,
  title: id,
  deadline: deadline ? new Date(`${deadline}T00:00:00Z`) : null,
  responsibleId: "u1",
  statusName: "В работе",
  archived: false,
  directorateId: "d1",
  ...over,
});

describe("pickDeadlineReminders", () => {
  // 08.10.2026 09:00 по Москве
  const now = new Date("2026-10-08T06:00:00Z");

  it("через 2 дня — «скоро», вчера — «просрочено», остальное — нет", () => {
    const r = pickDeadlineReminders([item("soon", "2026-10-10"), item("over", "2026-10-07"), item("today", "2026-10-08"), item("old", "2026-10-01"), item("far", "2026-10-20")], now);
    expect(r.soon.map((i) => i.id)).toEqual(["soon"]);
    expect(r.overdue.map((i) => i.id)).toEqual(["over"]);
  });

  it("закрытые статусы, удалённые, без срока и без ответственного не напоминаются", () => {
    const r = pickDeadlineReminders(
      [item("done", "2026-10-10", { statusName: "Завершено" }), item("na", "2026-10-07", { statusName: "Не актуально" }), item("arch", "2026-10-10", { archived: true }), item("nodl", null), item("noowner", "2026-10-10", { responsibleId: null })],
      now
    );
    expect(r.soon).toEqual([]);
    expect(r.overdue).toEqual([]);
  });

  it("день считается по Москве: 23:30 UTC — это уже следующий день", () => {
    expect(mskDay(new Date("2026-10-07T23:30:00Z"))).toBe(Date.UTC(2026, 9, 8));
    const late = new Date("2026-10-07T22:30:00Z"); // 01:30 МСК 08.10
    expect(pickDeadlineReminders([item("soon", "2026-10-10")], late).soon).toHaveLength(1);
  });
});
