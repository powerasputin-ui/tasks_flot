/**
 * Аналитика «Моего дня» ЗГД — только из подтверждённого директорами: отправленные справки (memo_versions) и решения
 * «Обновить для ЗГД» (item_publications). Чистые функции, без базы. Определения метрик — здесь, в одном месте
 * (их же показывают подсказки в интерфейсе):
 *  - Подтверждено: отправленные справки и решения директора — то же, что видит трекер ЗГД (карточка и трекер, куда она ведёт,
 *    показывают одинаковые числа). Возвращённая и ещё не отправленная заново справка учитывается, как в трекере, но карточка
 *    это явно помечает; недельные точки берутся только из невозвращённых справок.
 *  - Просрочено: по общему правилу lib/overdue.ts — активная (не «Выполнено»/«Не актуально» ни по колонке, ни по названию
 *    статуса), подтверждённый срок раньше дня снимка; «на стопе» тоже просрочена.
 *  - Сорван первый срок: исходный срок поручения, а если он ЗГД неизвестен (справка его не несёт) — первый срок, который
 *    директор подтвердил для ЗГД; прошёл, а задача активна.
 *  - Переносы за 30 дней: подтверждённые сдвиги срока на более поздний (просьбы о переносе не считаются).
 *  - Без движения 14+ дней: активная, подтверждённые статус/срок/ответственный/текст не менялись 14+ дней.
 *  - Выполнено вовремя за 30 дней: дата выполнения — когда «Выполнено» подтверждено для ЗГД. Вовремя — подтверждено не позже
 *    срока; точно с опозданием — ещё при прошлом подтверждении (уже после срока) задача была не выполнена; иначе — «не определить»
 *    (выполнена где-то между двумя подтверждениями, срок — посередине). Без срока — отдельно.
 *  - Свежесть: последнее подтверждение дирекции; старше 10 дней — «Нет актуальных данных» (это прозрачность, не оценка исполнения).
 * Недели: точка — последняя невозвращённая справка, отправленная в эту неделю. «Выполнено/новых за неделю» — изменения с предыдущей
 * такой справки (не «за 7 дней»: справки ходят не строго раз в 7 дней, окна перекрывались бы или теряли изменения).
 * Справку вернули и отправили заново — точка из новой ревизии и помечена (ревизия, дата, кто отправил).
 */
import { buildZgdTracker, columnByName, type Publication, type SentRow, type SentVersion } from "@/lib/tracker-sent";
import { PROTECTED_STATUSES } from "@/lib/statuses";
import type { TrackerColumnKey, TrackerEvent } from "@/lib/tracker";

const DAY = 864e5;
export const STALE_DAYS = 10;
export const SMALL_SAMPLE = 10;
export const TREND_WEEKS = 12;
export const RED_SHARE = 0.15;
export const YELLOW_SHARE = 0.05;
/** Выполненные и отменённые поручения во вкладке «Поручения» — за последние столько дней (старые не засоряют список). */
export const ORDERS_CLOSED_DAYS = 30;

/** Полночь UTC дня по Москве (сроки хранятся датой без времени). */
export const mskDayOf = (t: number | string | Date): number => {
  const m = new Date(new Date(t).getTime() + 3 * 3600e3);
  return Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate());
};
const dayOfDate = (d: string) => {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
};
const ms = (d: Date | string) => new Date(d).getTime();
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
/** Активная — не закрыта ни по колонке трекера, ни по названию системного статуса (как в lib/overdue.ts). */
const isActive = (r: SentRow, cols: Cols) => {
  const c = column(r, cols);
  return c !== "DONE" && c !== "HIDDEN" && !(r.statusName && PROTECTED_STATUSES.includes(r.statusName));
};
const isOverdueAt = (r: SentRow, cols: Cols, day: number) => isActive(r, cols) && !!r.deadline && dayOfDate(r.deadline) < day;
const CHANGE_KINDS = new Set<TrackerEvent["kind"]>(["created", "status", "deadline", "owner", "text", "workflow"]);

/** Состояние дирекции на момент t: только подтверждения не позже t. */
function stateAt(versions: SentVersion[], pubs: Publication[], t: number): SentRow[] {
  return buildZgdTracker(
    versions.filter((v) => ms(v.sentAt) <= t),
    pubs.filter((p) => ms(p.at) <= t),
  ).rows;
}

/** Когда задача последний раз перешла в колонку col (по событиям смены статуса). */
function enteredAt(events: TrackerEvent[], cols: Cols, col: TrackerColumnKey): number | null {
  const e = [...events].reverse().find((x) => x.kind === "status" && columnByName(x.after ?? null, cols) === col);
  return e ? ms(e.at) : null;
}

export type Timing = "ontime" | "late" | "unknown";
/**
 * Вовремя ли выполнено, по тому, что видел ЗГД: подтверждено не позже срока — вовремя; при прошлом подтверждении (уже после
 * срока) ещё не было выполнено — точно с опозданием; иначе не определить.
 */
export function doneTiming(deadline: string, doneAt: number, prevConfirmation: number | null): Timing {
  const dd = dayOfDate(deadline);
  if (mskDayOf(doneAt) <= dd) return "ontime";
  if (prevConfirmation !== null && mskDayOf(prevConfirmation) > dd) return "late";
  return "unknown";
}

export type TrendPoint = {
  week: number;
  overdue: number | null;
  active: number | null;
  done: number | null;
  created: number | null;
  /** Почему точки нет: справки не было · справку вернули и не отправили заново · неделя ещё идёт. */
  missing: "none" | "returned" | "pending" | null;
  /** Справку возвращали и отправили заново. */
  corrected: { revision: number; at: string; by: string | null } | null;
};
export type DirectorateCard = {
  id: string;
  name: string;
  lastConfirmedAt: string | null;
  /** Последняя справка дирекции возвращена ЗГД и ещё не отправлена заново — когда её отправляли. */
  lastReturnedAt: string | null;
  stale: boolean;
  tone: Tone;
  smallSample: boolean;
  active: number;
  overdue: number;
  overdueFirst: number;
  slips30: number;
  idle14: number;
  done30: { onTime: number; late: number; unknown: number; total: number; noDeadline: number };
  trend: TrendPoint[];
};

export type OrderSegment = "done" | "cancelled" | "overdue" | "soon" | "ontime";
export type OrderItem = {
  id: string;
  title: string;
  directorateId: string;
  directorateName: string;
  deadline: string | null;
  originalDeadline: string | null;
  moves: number;
  /** Дней с поручения (только у поручений — у задач «на контроле» даты постановки нет). */
  daysInWork: number | null;
  statusName: string | null;
  segment: OrderSegment;
  timing: Timing | null;
  mine: boolean;
  control: boolean;
};
export type OrdersView = { avgDays: number | null; avgN: number; byDir: Array<{ id: string; name: string } & Record<OrderSegment, number>>; items: OrderItem[] };

/**
 * Сегмент поручения — ровно один, по порядку: выполнено → отменено → сорвано → срок ≤ 3 дн. → в срок.
 * Выполненное, у которого срок был близко, — «выполнено», а не «срок скоро».
 */
export function orderSegment(column: TrackerColumnKey, deadline: string | null, today: number, statusName: string | null = null): OrderSegment {
  if (column === "DONE" || statusName === "Завершено") return "done";
  if (column === "HIDDEN" || statusName === "Не актуально") return "cancelled";
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
  const allRows: Array<{ row: SentRow; events: TrackerEvent[]; confirmations: number[] }> = [];

  const directorates: DirectorateCard[] = input.directorates.map((d) => {
    const all = input.versions.filter((v) => v.directorateId === d.id);
    // состояние — как в трекере ЗГД (все отправленные справки); недельные точки — только невозвращённые
    const versions = [...all].sort((a, b) => ms(a.sentAt) - ms(b.sentAt));
    const accepted = versions.filter((v) => !v.returnedAt);
    const latest = versions.at(-1);
    const pubs = input.publications.filter((p) => p.directorateId === d.id).sort((a, b) => ms(a.at) - ms(b.at));
    const built = buildZgdTracker(versions, pubs);
    const byItem = new Map<string, TrackerEvent[]>();
    for (const e of built.events) byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e]);

    // когда ЗГД подтверждали каждую задачу и первый подтверждённый срок (справка исходного срока не несёт)
    const confirmations = new Map<string, number[]>();
    const firstDeadline = new Map<string, string>();
    const seen = (id: string, t: number, deadline: string | null | undefined) => {
      confirmations.set(id, [...(confirmations.get(id) ?? []), t]);
      if (deadline && !firstDeadline.has(id)) firstDeadline.set(id, deadline);
    };
    const sources = [...versions.map((v) => ({ t: ms(v.sentAt), v })), ...pubs.map((p) => ({ t: ms(p.at), p }))].sort((a, b) => a.t - b.t);
    for (const s of sources) {
      if ("v" in s && s.v) for (const r of s.v.rows) seen(r.id, s.t, r.deadline);
      else if ("p" in s && s.p) seen(s.p.itemId, s.t, s.p.state.deadline);
    }
    const prevConfirmation = (id: string, t: number) => (confirmations.get(id) ?? []).filter((x) => x < t).at(-1) ?? null;

    // удалённые дирекцией у ЗГД не учитываются (как в трекере): живой задачи нет — строки нет
    const rows = built.rows.filter((r) => liveById.has(r.id));
    for (const r of rows) allRows.push({ row: r, events: byItem.get(r.id) ?? [], confirmations: confirmations.get(r.id) ?? [] });

    const times = sources.map((s) => s.t);
    const last = times.length ? Math.max(...times) : null;
    const stale = last === null || now - last > STALE_DAYS * DAY;
    const active = rows.filter((r) => isActive(r, cols));
    const overdue = active.filter((r) => isOverdueAt(r, cols, today)).length;
    const overdueFirst = active.filter((r) => {
      const first = r.originalDeadline ?? firstDeadline.get(r.id) ?? null;
      return !!first && dayOfDate(first) < today;
    }).length;
    const since30 = now - 30 * DAY;
    const slips30 = built.events.filter((e) => e.kind === "deadline" && (e.slip ?? 0) > 0 && ms(e.at) >= since30 && liveById.has(e.itemId)).length;
    const idle14 = active.filter((r) => {
      const changes = (byItem.get(r.id) ?? []).filter((e) => CHANGE_KINDS.has(e.kind)).map((e) => ms(e.at));
      return !changes.length || now - Math.max(...changes) >= 14 * DAY;
    }).length;
    const done30 = { onTime: 0, late: 0, unknown: 0, total: 0, noDeadline: 0 };
    for (const r of rows) {
      if (isActive(r, cols) || column(r, cols) === "HIDDEN") continue;
      const at = enteredAt(byItem.get(r.id) ?? [], cols, "DONE");
      if (at === null || at < since30) continue;
      if (!r.deadline) {
        done30.noDeadline++;
        continue;
      }
      done30.total++;
      const t = doneTiming(r.deadline, at, prevConfirmation(r.id, at));
      if (t === "ontime") done30.onTime++;
      else if (t === "late") done30.late++;
      else done30.unknown++;
    }

    // недели: последняя невозвращённая справка недели; «выполнено/новых» — с предыдущей справки (из более ранней недели)
    const trend: TrendPoint[] = weeks.map((w) => {
      const inWeek = accepted.filter((v) => weekStart(ms(v.sentAt)) === w);
      const v = inWeek.at(-1);
      if (!v) {
        const returned = all.some((x) => x.returnedAt && weekStart(ms(x.sentAt)) === w);
        return { week: w, overdue: null, active: null, done: null, created: null, missing: returned ? "returned" : w === thisWeek ? "pending" : "none", corrected: null };
      }
      const t = ms(v.sentAt);
      const snap = stateAt(versions, pubs, t);
      const prev = accepted.filter((x) => ms(x.sentAt) < w).at(-1);
      const before = prev ? new Map(stateAt(versions, pubs, ms(prev.sentAt)).map((r) => [r.id, r])) : null;
      const day = mskDayOf(t);
      const doneNow = (r: SentRow) => column(r, cols) === "DONE" || r.statusName === "Завершено";
      const returnedSameCycle = all.some((x) => x.cycleId && x.cycleId === v.cycleId && x.returnedAt);
      return {
        week: w,
        active: snap.filter((r) => isActive(r, cols)).length,
        overdue: snap.filter((r) => isOverdueAt(r, cols, day)).length,
        // история известна с этой справки — сравнивать не с чем
        done: before ? snap.filter((r) => doneNow(r) && !(before.has(r.id) && doneNow(before.get(r.id)!))).length : null,
        created: before ? snap.filter((r) => !before.has(r.id)).length : null,
        missing: null,
        corrected: (v.revision ?? 1) > 1 || returnedSameCycle ? { revision: v.revision ?? 1, at: new Date(v.sentAt).toISOString(), by: v.sentByName ?? null } : null,
      };
    });

    return { id: d.id, name: d.name, lastConfirmedAt: last ? new Date(last).toISOString() : null, lastReturnedAt: latest?.returnedAt ? new Date(latest.sentAt).toISOString() : null, stale, tone: toneOf(active.length, overdue, stale), smallSample: active.length > 0 && active.length < SMALL_SAMPLE, active: active.length, overdue, overdueFirst, slips30, idle14, done30, trend };
  });

  // поручения ЗГД и задачи «на контроле»: живые пометки самого ЗГД + подтверждённое состояние
  const items: OrderItem[] = [];
  const execDays: number[] = [];
  for (const { row: r, events, confirmations } of allRows) {
    const l = liveById.get(r.id)!;
    const mine = l.origin === "ZGD" && l.assignedById === input.meId;
    if (!mine && !l.zgdControl) continue;
    const col = column(r, cols);
    const segment = orderSegment(col, r.deadline, today, r.statusName);
    const closedAt = segment === "done" ? enteredAt(events, cols, "DONE") : segment === "cancelled" ? enteredAt(events, cols, "HIDDEN") : null;
    // закрытые давно (или когда — неизвестно) не засоряют список: вкладка про то, что требует вмешательства
    if ((segment === "done" || segment === "cancelled") && (closedAt === null || closedAt < now - ORDERS_CLOSED_DAYS * DAY)) continue;
    const assigned = l.assignedAt ? ms(l.assignedAt) : null;
    if (mine && segment === "done" && closedAt !== null && assigned !== null && closedAt >= now - 90 * DAY) execDays.push((closedAt - assigned) / DAY);
    items.push({
      id: r.id,
      title: r.name,
      directorateId: r.directorateId,
      directorateName: r.directorateName,
      deadline: r.deadline,
      originalDeadline: r.originalDeadline,
      moves: events.filter((e) => e.kind === "deadline" && (e.slip ?? 0) > 0).length,
      daysInWork: assigned !== null ? Math.max(0, Math.floor(((segment === "done" && closedAt !== null ? closedAt : now) - assigned) / DAY)) : null,
      statusName: r.statusName,
      segment,
      timing: segment === "done" && closedAt !== null && r.deadline ? doneTiming(r.deadline, closedAt, confirmations.filter((x) => x < closedAt).at(-1) ?? null) : null,
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
