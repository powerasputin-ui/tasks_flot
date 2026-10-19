import { describe, expect, it } from "vitest";
import { buildZgdAnalytics, orderSegment, toneOf, weekStart, type Live, type VersionMeta } from "@/lib/zgd-analytics";
import type { ArchiveRow } from "@/lib/archive-table";
import type { Publication } from "@/lib/tracker-sent";
import type { TrackerColumnKey } from "@/lib/tracker";

const DAY = 864e5;
// понедельник 19.10.2026, 12:00 МСК
const now = Date.UTC(2026, 9, 19, 9, 0);
const at = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();
const date = (daysFromNow: number) => {
  const d = new Date(now + daysFromNow * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
};
const cols = new Map<string, TrackerColumnKey | null>([
  ["Не начато", "TODO"],
  ["В работе", "DOING"],
  ["На проверке", "REVIEW"],
  ["Завершено", "DONE"],
  ["Не актуально", "HIDDEN"],
]);
const row = (id: string, o: Partial<ArchiveRow> = {}): ArchiveRow =>
  ({ id, segmentId: null, segmentName: null, trackName: null, name: `задача ${id}`, cost: null, attractivenessName: null, attractivenessColor: null, ownerName: "Иванов", ownerRole: "HEAD", deadline: null, deadlineWeek: null, statusName: "В работе", statusColor: null, comment: null, customValues: {}, submitted: true, inMemo: true, ...o }) as ArchiveRow;
const memo = (dir: string, daysAgo: number, rows: ArchiveRow[], o: Partial<VersionMeta> = {}): VersionMeta => ({ directorateId: dir, directorateName: dir.toUpperCase(), sentAt: at(daysAgo), title: "справка", rows, cycleId: `c-${dir}-${daysAgo}`, revision: 1, returnedAt: null, sentByName: "Директор", ...o });
const pub = (dir: string, itemId: string, daysAgo: number, state: Partial<Publication["state"]>, only?: string[]): Publication => ({ itemId, directorateId: dir, directorateName: dir.toUpperCase(), at: at(daysAgo), who: "Директор", reason: "принял", state: { name: `задача ${itemId}`, ...state }, only });
const live = (ids: string[], o: Partial<Live> = {}): Live[] => ids.map((id) => ({ id, origin: null, assignedById: null, assignedAt: null, zgdControl: false, ...o }));
const run = (versions: VersionMeta[], publications: Publication[], liveRows: Live[], dirs = ["a"]) => buildZgdAnalytics({ versions, publications, directorates: dirs.map((id) => ({ id, name: id.toUpperCase() })), statusColumns: cols, live: liveRows, meId: "zgd", now });

describe("аналитика ЗГД: светофор и определения", () => {
  it("цвет — по доле просрочек; нет задач и нет свежих данных — отдельные статусы", () => {
    expect(toneOf(0, 0, false)).toBe("empty");
    expect(toneOf(10, 2, true)).toBe("stale");
    expect(toneOf(100, 4, false)).toBe("green");
    expect(toneOf(100, 5, false)).toBe("yellow");
    expect(toneOf(100, 15, false)).toBe("yellow");
    expect(toneOf(100, 16, false)).toBe("red");
  });

  it("карточка: «x из y», малая выборка, исходный срок из подтверждения, удалённые дирекцией не считаются", () => {
    const v = memo("a", 2, [row("1", { deadline: date(-3) }), row("2", { deadline: date(5) }), row("3", { statusName: "Завершено", deadline: date(-10) }), row("gone", { deadline: date(-1) })]);
    const p = pub("a", "2", 1, { originalDeadline: date(-1) }, ["originalDeadline"]);
    const r = run([v], [p], live(["1", "2", "3"]));
    const c = r.directorates[0];
    expect(c).toMatchObject({ active: 2, overdue: 1, overdueOriginal: 1, smallSample: true, stale: false, tone: "red" });
  });

  it("нет справки 10+ дней — «нет актуальных данных»; возвращённая справка подтверждением не считается", () => {
    const old = memo("a", 12, [row("1")]);
    const returned = memo("a", 1, [row("1")], { returnedAt: at(0.5) });
    const c = run([old, returned], [], live(["1"])).directorates[0];
    expect(c.stale).toBe(true);
    expect(c.tone).toBe("stale");
    expect(run([], [], []).directorates[0]).toMatchObject({ stale: true, lastConfirmedAt: null, active: 0 });
  });

  it("переносы за 30 дней — только подтверждённые сдвиги позже; выполнено вовремя — n из m, без срока отдельно", () => {
    const v = memo("a", 40, [row("1", { deadline: date(-20) }), row("2", { deadline: date(-15) }), row("3"), row("4", { deadline: date(10) })]);
    const pubs = [
      pub("a", "4", 5, { deadline: date(20) }, ["deadline"]), // перенос +10 дней
      pub("a", "1", 25, { statusName: "Завершено" }, ["statusName"]), // выполнено 25 дней назад, срок был 20 дней назад — вовремя
      pub("a", "2", 3, { statusName: "Завершено" }, ["statusName"]), // выполнено после срока
      pub("a", "3", 2, { statusName: "Завершено" }, ["statusName"]), // без срока
    ];
    const c = run([v], pubs, live(["1", "2", "3", "4"])).directorates[0];
    expect(c.slips30).toBe(1);
    expect(c.done30).toEqual({ onTime: 1, total: 2, noDeadline: 1 });
  });

  it("без движения 14+ дней: нет подтверждённых изменений за 14 дней", () => {
    const v1 = memo("a", 30, [row("1"), row("2")]);
    const v2 = memo("a", 3, [row("1"), row("2", { statusName: "На проверке" })]);
    expect(run([v1, v2], [], live(["1", "2"])).directorates[0].idle14).toBe(1);
  });
});

describe("аналитика ЗГД: динамика по неделям", () => {
  it("неделя без справки — пусто (не ноль); точка — последняя невозвращённая ревизия; повторная отправка помечена", () => {
    const w1 = memo("a", 14, [row("1", { deadline: date(-30) })], { cycleId: "c1" });
    const first = memo("a", 7, [row("1", { deadline: date(-30) }), row("2")], { cycleId: "c2", revision: 1, returnedAt: at(6.9) });
    const resent = memo("a", 6.8, [row("1", { statusName: "Завершено", deadline: date(-30) }), row("2")], { cycleId: "c2", revision: 2, sentByName: "Сухов" });
    const r = run([w1, first, resent], [], live(["1", "2"]));
    const pts = r.directorates[0].trend;
    expect(pts).toHaveLength(12);
    const byWeek = new Map(pts.map((p) => [p.week, p]));
    const p1 = byWeek.get(weekStart(now - 14 * DAY))!;
    expect(p1).toMatchObject({ overdue: 1, corrected: null });
    const p2 = byWeek.get(weekStart(now - 6.8 * DAY))!;
    expect(p2.overdue).toBe(0);
    expect(p2.done).toBe(1);
    expect(p2.created).toBe(1);
    expect(p2.corrected).toMatchObject({ revision: 2, by: "Сухов" });
    expect(byWeek.get(weekStart(now))!.overdue).toBeNull();
  });
});

describe("аналитика ЗГД: поручения", () => {
  it("сегмент ровно один: выполнено → отменено → сорвано → срок ≤ 3 дн. → в срок", () => {
    const today = Date.UTC(2026, 9, 19);
    expect(orderSegment("DONE", "2026-10-20T00:00:00.000Z", today)).toBe("done");
    expect(orderSegment("HIDDEN", "2026-10-01T00:00:00.000Z", today)).toBe("cancelled");
    expect(orderSegment("DOING", "2026-10-18T00:00:00.000Z", today)).toBe("overdue");
    expect(orderSegment("DOING", "2026-10-22T00:00:00.000Z", today)).toBe("soon");
    expect(orderSegment("DOING", "2026-10-23T00:00:00.000Z", today)).toBe("ontime");
    expect(orderSegment("TODO", null, today)).toBe("ontime");
  });

  it("мои поручения и «на контроле»; среднее время — только завершённые мои за 90 дней; сорванные сверху", () => {
    const v = memo("a", 20, [row("o1", { deadline: date(-2) }), row("o2", { deadline: date(30) }), row("c1", { deadline: date(2) }), row("x")]);
    const pubs = [pub("a", "o2", 4, { statusName: "Завершено" }, ["statusName"])];
    const liveRows = [
      ...live(["o1"], { origin: "ZGD", assignedById: "zgd", assignedAt: at(10) }),
      ...live(["o2"], { origin: "ZGD", assignedById: "zgd", assignedAt: at(14) }),
      ...live(["c1"], { zgdControl: true }),
      ...live(["x"], { origin: "ZGD", assignedById: "someone-else" }),
    ];
    const o = run([v], pubs, liveRows).orders;
    expect(o.items.map((i) => [i.id, i.segment])).toEqual([
      ["o1", "overdue"],
      ["c1", "soon"],
      ["o2", "done"],
    ]);
    expect(o.avgDays).toBe(10);
    expect(o.avgN).toBe(1);
    expect(o.byDir[0]).toMatchObject({ id: "a", overdue: 1, soon: 1, done: 1, ontime: 0, cancelled: 0 });
  });
});
