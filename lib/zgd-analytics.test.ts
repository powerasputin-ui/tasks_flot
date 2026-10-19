import { describe, expect, it } from "vitest";
import { buildZgdAnalytics, doneTiming, orderSegment, toneOf, weekStart, type Live, type VersionMeta } from "@/lib/zgd-analytics";
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
  ["На стопе", "DOING"],
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

  it("карточка: «x из y», малая выборка, «на стопе» — тоже просрочка (общее правило), первый срок — исходный или первый подтверждённый; удалённые не считаются", () => {
    const v = memo("a", 2, [row("1", { deadline: date(-3) }), row("2", { deadline: date(5) }), row("3", { statusName: "Завершено", deadline: date(-10) }), row("4", { statusName: "На стопе", deadline: date(-1) }), row("gone", { deadline: date(-1) })]);
    const p = pub("a", "2", 1, { originalDeadline: date(-1) }, ["originalDeadline"]);
    const c = run([v], [p], live(["1", "2", "3", "4"])).directorates[0];
    expect(c).toMatchObject({ active: 3, overdue: 2, smallSample: true, stale: false, tone: "red" });
    // 1 и 4 — первый подтверждённый срок прошёл; 2 — исходный срок поручения прошёл, хотя текущий ещё нет
    expect(c.overdueFirst).toBe(3);
  });

  it("возвращённая справка учитывается, как в трекере ЗГД (одинаковые числа), но карточка помечает её; данных 10+ дней нет — «нет актуальных данных»", () => {
    const old = memo("a", 12, [row("1")]);
    const returned = memo("a", 1, [row("1"), row("9", { deadline: date(-5) })], { returnedAt: at(0.5) });
    const c = run([old, returned], [], live(["1", "9"])).directorates[0];
    expect(c).toMatchObject({ stale: false, active: 2, overdue: 1, lastReturnedAt: at(1) });
    expect(run([old], [], live(["1"])).directorates[0]).toMatchObject({ stale: true, tone: "stale", lastReturnedAt: null });
    expect(run([], [], []).directorates[0]).toMatchObject({ stale: true, lastConfirmedAt: null, active: 0 });
  });

  it("переносы за 30 дней — только подтверждённые сдвиги позже; выполнено: вовремя / точно с опозданием / не определить / без срока", () => {
    const v40 = memo("a", 40, [row("1", { deadline: date(-20) }), row("2", { deadline: date(-15) }), row("3"), row("4", { deadline: date(10) }), row("6", { deadline: date(-5) })]);
    const v10 = memo("a", 10, [row("1", { deadline: date(-20), statusName: "Завершено" }), row("2", { deadline: date(-15) }), row("3"), row("4", { deadline: date(10) }), row("6", { deadline: date(-5) })]);
    const pubs = [
      pub("a", "1", 25, { statusName: "Завершено" }, ["statusName"]), // подтверждено за 5 дней до срока — вовремя
      pub("a", "4", 5, { deadline: date(20) }, ["deadline"]), // перенос +10 дней
      pub("a", "2", 3, { statusName: "Завершено" }, ["statusName"]), // при справке 10 дней назад (срок уже прошёл) ещё не было — с опозданием
      pub("a", "6", 3, { statusName: "Завершено" }, ["statusName"]), // между справкой (до срока) и подтверждением (после) — не определить
      pub("a", "3", 2, { statusName: "Завершено" }, ["statusName"]), // без срока
    ];
    const c = run([v40, v10], pubs, live(["1", "2", "3", "4", "6"])).directorates[0];
    expect(c.slips30).toBe(1);
    expect(c.done30).toEqual({ onTime: 1, late: 1, unknown: 1, total: 3, noDeadline: 1 });
  });

  it("doneTiming: вовремя / с опозданием / не определить", () => {
    const dl = "2026-10-10T00:00:00.000Z";
    expect(doneTiming(dl, Date.UTC(2026, 9, 10, 15), null)).toBe("ontime");
    expect(doneTiming(dl, Date.UTC(2026, 9, 14), Date.UTC(2026, 9, 12))).toBe("late");
    expect(doneTiming(dl, Date.UTC(2026, 9, 14), Date.UTC(2026, 9, 8))).toBe("unknown");
    expect(doneTiming(dl, Date.UTC(2026, 9, 14), null)).toBe("unknown");
  });

  it("без движения 14+ дней: нет подтверждённых изменений за 14 дней", () => {
    const v1 = memo("a", 30, [row("1"), row("2")]);
    const v2 = memo("a", 3, [row("1"), row("2", { statusName: "На проверке" })]);
    expect(run([v1, v2], [], live(["1", "2"])).directorates[0].idle14).toBe(1);
  });
});

describe("аналитика ЗГД: динамика по неделям", () => {
  it("неделя без справки — пусто (не ноль): «справки не было», «вернули», «неделя идёт»; первая справка истории — без сравнения; повторная отправка помечена", () => {
    const vReturnedOnly = memo("a", 21, [row("1")], { cycleId: "c0", returnedAt: at(20) });
    const w1 = memo("a", 14, [row("1", { deadline: date(-30) })], { cycleId: "c1" });
    const first = memo("a", 7, [row("1", { deadline: date(-30) }), row("2")], { cycleId: "c2", revision: 1, returnedAt: at(6.9) });
    const resent = memo("a", 6.8, [row("1", { statusName: "Завершено", deadline: date(-30) }), row("2")], { cycleId: "c2", revision: 2, sentByName: "Сухов" });
    const pts = run([vReturnedOnly, w1, first, resent], [], live(["1", "2"])).directorates[0].trend;
    expect(pts).toHaveLength(12);
    const byWeek = new Map(pts.map((p) => [p.week, p]));
    expect(byWeek.get(weekStart(now - 21 * DAY))).toMatchObject({ overdue: null, missing: "returned" });
    expect(byWeek.get(weekStart(now - 14 * DAY))).toMatchObject({ overdue: 1, created: null, done: null, corrected: null, missing: null });
    const p2 = byWeek.get(weekStart(now - 6.8 * DAY))!;
    expect(p2).toMatchObject({ overdue: 0, done: 1, created: 1 });
    expect(p2.corrected).toMatchObject({ revision: 2, by: "Сухов" });
    expect(byWeek.get(weekStart(now))).toMatchObject({ overdue: null, missing: "pending" });
    expect(byWeek.get(weekStart(now - 35 * DAY))).toMatchObject({ overdue: null, missing: "none" });
  });

  it("«новых за неделю» — с предыдущей справки, а не за 7 дней: при неровном графике справок изменения не теряются и не задваиваются", () => {
    // справка A — пн 05.10, справка B — пт 16.10; задачу X подтвердили отдельно в ср 07.10 (за 9 дней до B)
    const a = memo("a", 14, [row("1")]);
    const pX = pub("a", "x", 12, { statusName: "В работе", deadline: date(10) });
    const b = memo("a", 3, [row("1"), row("x", { deadline: date(10) })]);
    const pts = run([a, b], [pX], live(["1", "x"])).directorates[0].trend;
    const pb = pts.find((p) => p.week === weekStart(now - 3 * DAY))!;
    expect(pb.created).toBe(1);
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
    // системный статус «Завершено» закрывает задачу и без колонки трекера
    expect(orderSegment("TODO", "2026-10-01T00:00:00.000Z", today, "Завершено")).toBe("done");
  });

  it("мои поручения и «на контроле»; закрытые давно не показываются; среднее время — только завершённые мои за 90 дней; сорванные сверху", () => {
    const v = memo("a", 60, [row("o1", { deadline: date(-2) }), row("o2", { deadline: date(30) }), row("c1", { deadline: date(2) }), row("x"), row("old", { deadline: date(-40) })]);
    const pubs = [pub("a", "o2", 4, { statusName: "Завершено" }, ["statusName"]), pub("a", "old", 45, { statusName: "Завершено" }, ["statusName"])];
    const liveRows = [
      ...live(["o1"], { origin: "ZGD", assignedById: "zgd", assignedAt: at(10) }),
      ...live(["o2"], { origin: "ZGD", assignedById: "zgd", assignedAt: at(14) }),
      ...live(["old"], { origin: "ZGD", assignedById: "zgd", assignedAt: at(55) }),
      ...live(["c1"], { zgdControl: true }),
      ...live(["x"], { origin: "ZGD", assignedById: "someone-else" }),
    ];
    const o = run([v], pubs, liveRows).orders;
    expect(o.items.map((i) => [i.id, i.segment])).toEqual([
      ["o1", "overdue"],
      ["c1", "soon"],
      ["o2", "done"],
    ]);
    expect(o.items.find((i) => i.id === "o2")).toMatchObject({ timing: "ontime", daysInWork: 10 });
    expect(o.items.find((i) => i.id === "c1")!.daysInWork).toBeNull();
    expect(o.avgDays).toBe(10);
    expect(o.avgN).toBe(1);
    expect(o.byDir[0]).toMatchObject({ id: "a", overdue: 1, soon: 1, done: 1, ontime: 0, cancelled: 0 });
  });
});
