import { columnOf, mskDay, ruDay, type TrackerColumnKey } from "@/lib/tracker";

/**
 * «Мой день»: что требует внимания человека сегодня — по его роли, из тех же данных, что трекер (строки + «горит»).
 * Чистая функция без базы: страница и тесты берут её результат как есть.
 *  - Руководитель: свои задачи — просрочено, срок скоро, на стопе, сдано и ждёт директора.
 *  - Директор и админ: вся дирекция — ждёт решения, запросы ЗГД без ответа, просьбы о переносе срока, просрочено, срок скоро.
 *  - ЗГД: запросы без ответа, просрочено, срок скоро, его поручения в работе.
 */
export type TodayRow = {
  id: string;
  name: string;
  statusId: string | null;
  statusName: string | null;
  deadline: string | null;
  ownerId: string | null;
  ownerName: string | null;
  archived?: boolean;
  origin?: string | null;
  assignedById?: string | null;
  openRequest?: boolean;
  blockedBy?: string | null;
};
export type TodayHot = Record<string, { kinds: string[] }>;
export type TodayItem = { id: string; name: string; ownerName: string | null; deadline: string | null; note: string };
export type TodaySection = { key: string; title: string; hint: string; tone: "red" | "amber" | "primary" | "grey"; items: TodayItem[] };

/** Срок «скоро» — столько дней вперёд (включая сегодня): как сигнал «срок близко» в трекере. */
export const SOON_DAYS = 3;
const DAY = 864e5;

const dayOf = (d: string) => {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
};

export function buildToday(input: { role: string; meId: string; rows: TodayRow[]; hot: TodayHot; colOf: Map<string, TrackerColumnKey | null>; now: number }): TodaySection[] {
  const { role, meId, hot, colOf } = input;
  const today = mskDay(input.now);
  const column = (r: TodayRow) => columnOf(r.statusId, colOf);
  const open = (r: TodayRow) => !r.archived && column(r) !== "DONE" && column(r) !== "HIDDEN";
  const mine = role === "HEAD";
  const scope = input.rows.filter((r) => open(r) && (!mine || r.ownerId === meId));
  const kinds = (r: TodayRow) => hot[r.id]?.kinds ?? [];
  const byDeadline = (a: TodayItem, b: TodayItem) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
  const item = (r: TodayRow, note: string): TodayItem => ({ id: r.id, name: r.name, ownerName: r.ownerName, deadline: r.deadline, note });
  const diff = (r: TodayRow) => (r.deadline ? Math.round((dayOf(r.deadline) - today) / DAY) : null);
  const pick = (f: (r: TodayRow) => string | null) => scope.flatMap((r) => { const note = f(r); return note === null ? [] : [item(r, note)]; }).sort(byDeadline);

  const overdue = pick((r) => {
    const d = diff(r);
    return d !== null && d < 0 && !kinds(r).includes("blocker") ? `просрочено на ${-d} дн. (срок ${ruDay(r.deadline!)})` : null;
  });
  const soon = pick((r) => {
    const d = diff(r);
    return d !== null && d >= 0 && d <= SOON_DAYS ? (d === 0 ? "срок сегодня" : `срок через ${d} дн. (${ruDay(r.deadline!)})`) : null;
  });
  const review = pick((r) => (column(r) === "REVIEW" ? "сдана на проверку" : null));
  const stopped = pick((r) => (kinds(r).includes("blocker") || !!r.blockedBy ? (r.blockedBy ? `на стопе: ${r.blockedBy}` : "на стопе") : null));
  const asked = pick((r) => (kinds(r).includes("request") || r.openRequest ? "ЗГД запросил статус — ответа нет" : null));
  const moves = pick((r) => (kinds(r).includes("deadlineRequest") ? "просят перенести срок — нужно решение" : null));
  const orders = input.rows.filter((r) => open(r) && r.origin === "ZGD" && r.assignedById === meId).map((r) => item(r, r.statusName ?? "в работе")).sort(byDeadline);

  const S = (key: string, title: string, hint: string, tone: TodaySection["tone"], items: TodayItem[]): TodaySection => ({ key, title, hint, tone, items });
  const all: TodaySection[] =
    role === "HEAD"
      ? [S("overdue", "Просрочено", "Срок прошёл, задача не выполнена", "red", overdue), S("soon", "Срок скоро", `Сегодня и ближайшие ${SOON_DAYS} дня`, "amber", soon), S("stopped", "На стопе", "Ждёте чужого решения или документа", "amber", stopped), S("review", "Ждёт директора", "Сдано на проверку — директор ещё не принял и не вернул", "primary", review)]
      : role === "EXECUTIVE"
        ? [S("asked", "Запросы без ответа", "Вы спросили статус — директор ещё не ответил", "red", asked), S("overdue", "Просрочено", "Срок прошёл, задача не выполнена", "red", overdue), S("soon", "Срок скоро", `Сегодня и ближайшие ${SOON_DAYS} дня`, "amber", soon), S("orders", "Ваши поручения в работе", "Поручения, которые вы дали и которые ещё не выполнены", "grey", orders)]
        : [S("review", "Ждут вашего решения", "Сданы на проверку — примите или верните", "primary", review), S("asked", "Запросы ЗГД без ответа", "ЗГД спросил статус — ответьте", "red", asked), S("moves", "Просят перенести срок", "Решение по сроку за вами", "amber", moves), S("overdue", "Просрочено", "Срок прошёл, задача не выполнена", "red", overdue), S("soon", "Срок скоро", `Сегодня и ближайшие ${SOON_DAYS} дня`, "amber", soon)];
  return all.filter((s) => s.items.length > 0);
}
