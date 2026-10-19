/**
 * Аналитика «Моего дня» ЗГД — только из подтверждённого директорами: отправленные справки (memo_versions) и решения
 * «Обновить для ЗГД» (item_publications). Чистые функции, без базы. Определения метрик — здесь, в одном месте
 * (их же показывают подсказки в интерфейсе):
 *  - Просрочено: активная задача (не «Выполнено», не «Не актуально»), подтверждённый срок раньше даты снимка.
 *  - Сорван исходный срок: активная, исходный срок (originalDeadline) раньше даты снимка.
 *  - Переносы за 30 дней: подтверждённые сдвиги срока на более поздний (просьбы о переносе не считаются).
 *  - Без движения 14+ дней: активная, подтверждённые статус/срок/ответственный/текст не менялись 14+ дней.
 *  - Выполнено вовремя за 30 дней: подтверждено «Выполнено» за 30 дней и день выполнения не позже срока;
 *    знаменатель — выполненные со сроком, «без срока» — отдельно.
 *  - Свежесть: последнее подтверждение дирекции; старше 10 дней — «Нет актуальных данных» (это прозрачность, не оценка исполнения).
 * История не переписывается: точка недели — последняя невозвращённая ревизия справки этой недели; повторная отправка
 * после возврата помечается (ревизия, дата, кто отправил).
 */
import { buildZgdTracker, columnByName, type Publication, type SentRow, type SentVersion } from "@/lib/tracker-sent";
import type { TrackerColumnKey, TrackerEvent } from "@/lib/tracker";

const DAY = 864e5;
export const STALE_DAYS = 10;
export const SMALL_SAMPLE = 10;
export const TREND_WEEKS = 12;
export const RED_SHARE = 0.15;
export const YELLOW_SHARE = 0.05;

/** Полночь UTC дня по Москве (сроки хранятся датой без времени). */
export const mskDayOf = (t: number | string | Date): number => {
  const m = new Date(new Date(t).getTime() + 3 * 3600e3);
  return Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate());
};
const dayOfDate = (d: string) => {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
};
/** Понедельник недели (по Москве) — начало недели. */
export const weekStart = (t: number): number => {
  const d = mskDayOf(t);
  const wd = (new Date(d).getUTCDay() + 6) % 7;
  return d - wd * DAY;
};

export type Tone = "green" | "yellow" | "red" | "stale" | "empty";
/** Цвет карточки: по доле просрочек среди активных; устаревшие данные и «нет задач» — отдельные статусы, не оценка исполнения. */
export function toneOf(active: number, overdue: number, stale: boolean): Tone {
  if (stale) return "stale";
  if (active === 0) return "empty";
  const share = overdue / active;
  return share > RED_SHARE ? "red" : share >= YELLOW_SHARE ? "yellow" : "green";
}

type Cols = Map<string, TrackerColumnKey | null>;
const column = (r: { statusName: string | null }, cols: Cols) => columnByName(r.statusName, cols);
const isActive = (r: SentRow, cols: Cols) => {
  const c = column(r, cols);
  return c !== "DONE" && c !== "HIDDEN";
};
const CHANGE_KINDS = new Set<TrackerEvent["kind"]>(["created", "status", "deadline", "owner", "text", "workflow"]);

/** Состояние дирекции на момент t: только подтверждения не позже t. */
function stateAt(versions: SentVersion[], pubs: Publication[], t: number): SentRow[] {
  return buildZgdTracker(
    versions.filter((v) => new Date(v.sentAt).getTime() <= t),
    pubs.filter((p) => new Date(p.at).getTime() <= t),
  ).rows;
}

/** Когда задача стала «Выполнено» последний раз (по событиям смены статуса). */
function doneAtOf(events: TrackerEvent[], cols: Cols): number | null {
  const e = [...events].reverse().find((x) => x.kind === "status" && columnByName(x.after ?? null, cols) === "DONE");
  return e ? new Date(e.at).getTime() : null;
}

export type TrendPoint = { week: number; overdue: number | null; active: number | null; done: number | null; created: number | null; corrected: { revision: number; at: string; by: string | null } | null };
export type DirectorateCard = {
  id: string;
  name: string;
  lastConfirmedAt: string | null;
  stale: boolean;
  tone: Tone;
  smallSample: boolean;
  active: number;
  overdue: number;
  overdueOriginal: number;
  slips30: number;
  idle14: number;
  done30: { onTime: number; total: number; noDeadline: number };
  trend: TrendPoint[];
};

export type OrderSegment = "done" | "cancelled" | "overdue" | "soon" | "ontime";
export type OrderItem = { id: string; title: string; directorateId: string; directorateName: string; deadline: string | null; originalDeadline: string | null; moves: number; daysInWork: number | null; statusName: string | null; segment: OrderSegment; late: boolean; mine: boolean; control: boolean };
export type OrdersView = { avgDays: number | null; avgN: number; byDir: Array<{ id: string; name: string } & Record<OrderSegment, number>>; items: OrderItem[] };

/**
 * Сегмент поручения — ровно один, по порядку: выполнено → отменено → сорвано → срок ≤ 3 дн. → в срок.
 * Выполненное, у которого срок был близко, — «выполнено», а не «срок скоро».
 */
export function orderSegment(column: TrackerColumnKey, deadline: string | null, today: number): OrderSegment {
  if (column === "DONE") return "done";
  if (column === "HIDDEN") return "cancelled";
  if (deadline) {
    const d = Math.round((dayOfDate(deadline) - today) / DAY);
    if (d < 0) return "overdue";
    if (d <= 3) return "soon";
  }
  return "ontime";
}

export type VersionMeta = SentVersion;
export type Live = { id: string; origin: string | null; assignedById: string | null; assignedAt: Date | string | null; zgdControl: boolean };

export function buildZgdAnalytics(input: {
  versions: VersionMeta[];
  publications: Publication[];
  directorates: Array<{ id: string; name: string }>;
  statusColumns: Cols;
  live: Live[];
  meId: string;
  now: number;
}): { weeks: number[]; directorates: DirectorateCard[]; orders: OrdersView } {
  const { statusColumns: cols, now } = input;
  const today = mskDayOf(now);
  const thisWeek = weekStart(now);
  const weeks = Array.from({ length: TREND_WEEKS }, (_, i) => thisWeek - (TREND_WEEKS - 1 - i) * 7 * DAY);
  const liveById = new Map(input.live.map((l) => [l.id, l]));
  const allRows: Array<{ row: SentRow; events: TrackerEvent[] }> = [];

  const directorates: DirectorateCard[] = input.directorates.map((d) => {
    const versions = input.versions.filter((v) => v.directorateId === d.id);
    const pubs = input.publications.filter((p) => p.directorateId === d.id);
    const built = buildZgdTracker(versions, pubs);
    const byItem = new Map<string, TrackerEvent[]>();
    for (const e of built.events) byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e]);
    // удалённые дирекцией у ЗГД не учитываются (как в трекере): живой задачи нет — строки нет
    const rows = built.rows.filter((r) => liveById.has(r.id));
    for (const r of rows) allRows.push({ row: r, events: byItem.get(r.id) ?? [] });

    const confirmations = [...versions.filter((v) => !v.returnedAt).map((v) => new Date(v.sentAt).getTime()), ...pubs.map((p) => new Date(p.at).getTime())];
    const last = confirmations.length ? Math.max(...confirmations) : null;
    const stale = last === null || now - last > STALE_DAYS * DAY;
    const active = rows.filter((r) => isActive(r, cols));
    const overdue = active.filter((r) => r.deadline && dayOfDate(r.deadline) < today).length;
    const overdueOriginal = active.filter((r) => r.originalDeadline && dayOfDate(r.originalDeadline) < today).length;
    const since30 = now - 30 * DAY;
    const slips30 = built.events.filter((e) => e.kind === "deadline" && (e.slip ?? 0) > 0 && new Date(e.at).getTime() >= since30 && liveById.has(e.itemId)).length;
    const idle14 = active.filter((r) => {
      const changes = (byItem.get(r.id) ?? []).filter((e) => CHANGE_KINDS.has(e.kind)).map((e) => new Date(e.at).getTime());
      return !changes.length || now - Math.max(...changes) >= 14 * DAY;
    }).length;
    const done30 = { onTime: 0, total: 0, noDeadline: 0 };
    for (const r of rows) {
      if (column(r, cols) !== "DONE") continue;
      const at = doneAtOf(byItem.get(r.id) ?? [], cols);
      if (at === null || at < since30) continue;
      if (!r.deadline) {
        done30.noDeadline++;
        continue;
      }
      done30.total++;
      if (mskDayOf(at) <= dayOfDate(r.deadline)) done30.onTime++;
    }

    // недели: последняя невозвращённая ревизия справки, отправленная в эту неделю
    const trend: TrendPoint[] = weeks.map((w) => {
      const inWeek = versions.filter((v) => !v.returnedAt && weekStart(new Date(v.sentAt).getTime()) === w).sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
      const v = inWeek.at(-1);
      if (!v) return { week: w, overdue: null, active: null, done: null, created: null, corrected: null };
      const t = new Date(v.sentAt).getTime();
      const snap = stateAt(versions, pubs, t);
      const before = new Map(stateAt(versions, pubs, t - 7 * DAY).map((r) => [r.id, r]));
      const snapActive = snap.filter((r) => isActive(r, cols));
      const day = mskDayOf(t);
      const returnedSameCycle = versions.some((x) => x.cycleId && x.cycleId === v.cycleId && x.returnedAt);
      return {
        week: w,
        active: snapActive.length,
        overdue: snapActive.filter((r) => r.deadline && dayOfDate(r.deadline) < day).length,
        done: snap.filter((r) => column(r, cols) === "DONE" && (!before.has(r.id) || column(before.get(r.id)!, cols) !== "DONE")).length,
        created: snap.filter((r) => !before.has(r.id)).length,
        corrected: (v.revision ?? 1) > 1 || returnedSameCycle ? { revision: v.revision ?? 1, at: new Date(v.sentAt).toISOString(), by: v.sentByName ?? null } : null,
      };
    });

    return { id: d.id, name: d.name, lastConfirmedAt: last ? new Date(last).toISOString() : null, stale, tone: toneOf(active.length, overdue, stale), smallSample: active.length > 0 && active.length < SMALL_SAMPLE, active: active.length, overdue, overdueOriginal, slips30, idle14, done30, trend };
  });

  // поручения ЗГД и задачи «на контроле»: живые пометки самого ЗГД + подтверждённое состояние
  const items: OrderItem[] = [];
  const execDays: number[] = [];
  for (const { row: r, events } of allRows) {
    const l = liveById.get(r.id)!;
    const mine = l.origin === "ZGD" && l.assignedById === input.meId;
    if (!mine && !l.zgdControl) continue;
    const col = column(r, cols);
    const segment = orderSegment(col, r.deadline, today);
    const doneAt = col === "DONE" ? doneAtOf(events, cols) : null;
    const start = l.assignedAt ? new Date(l.assignedAt).getTime() : (events.find((e) => e.kind === "created")?.at ? new Date(events.find((e) => e.kind === "created")!.at).getTime() : null);
    const end = doneAt ?? now;
    if (mine && doneAt !== null && l.assignedAt && doneAt >= now - 90 * DAY) execDays.push((doneAt - new Date(l.assignedAt).getTime()) / DAY);
    items.push({
      id: r.id,
      title: r.name,
      directorateId: r.directorateId,
      directorateName: r.directorateName,
      deadline: r.deadline,
      originalDeadline: r.originalDeadline,
      moves: events.filter((e) => e.kind === "deadline" && (e.slip ?? 0) > 0).length,
      daysInWork: start !== null ? Math.max(0, Math.floor((end - start) / DAY)) : null,
      statusName: r.statusName,
      segment,
      late: segment === "done" && !!r.deadline && doneAt !== null && mskDayOf(doneAt) > dayOfDate(r.deadline),
      mine,
      control: l.zgdControl,
    });
  }
  const order: Record<OrderSegment, number> = { overdue: 0, soon: 1, ontime: 2, done: 3, cancelled: 4 };
  items.sort((a, b) => order[a.segment] - order[b.segment] || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  const byDir = input.directorates
    .map((d) => {
      const own = items.filter((i) => i.directorateId === d.id);
      const c = { done: 0, cancelled: 0, overdue: 0, soon: 0, ontime: 0 } as Record<OrderSegment, number>;
      for (const i of own) c[i.segment]++;
      return { id: d.id, name: d.name, ...c, total: own.length };
    })
    .filter((x) => x.total > 0)
    .map(({ total: _t, ...rest }) => (void _t, rest));
  const avgDays = execDays.length ? Math.round((execDays.reduce((s, x) => s + x, 0) / execDays.length) * 10) / 10 : null;
  return { weeks, directorates, orders: { avgDays, avgN: execDays.length, byDir, items } };
}
