import { columnOf, mskDay, ruDay, type TrackerColumnKey } from "@/lib/tracker";

/**
 * «Мой день»: что требует внимания человека сегодня — по его роли, из тех же данных, что трекер (строки, «горит», журнал).
 * Чистая функция без базы: страница и тесты берут её результат как есть.
 * Каждая задача — в одном разделе, самом важном для роли (разделы идут по важности); остальное о ней — в пояснении.
 *  - Руководитель: свои задачи — вернули на доработку, просрочено, поручения не начаты, срок скоро, на стопе, ждёт директора.
 *  - Директор и админ: вся дирекция — ждут решения, запросы ЗГД без ответа, просьбы о переносе срока, поручения без ответственного,
 *    просрочено, срок скоро.
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
  assignedByName?: string | null;
  openRequest?: boolean;
  blockedBy?: string | null;
  /** ЗГД: дирекция строки (отключённые дирекции в «Моём дне» не показываем, название — рядом с задачей). */
  directorateId?: string;
  directorateName?: string | null;
};
/** Событие журнала трекера (lib/tracker.ts, TrackerEvent): отсюда — «вернули на доработку», кто и с каким замечанием. */
export type TodayEvent = { itemId: string; at: string; kind: string; who: string | null; text: string };
export type TodayHot = Record<string, { kinds: string[] }>;
export type TodayItem = { id: string; name: string; ownerName: string | null; deadline: string | null; note: string; directorate?: string | null };
export type TodaySection = { key: string; title: string; hint: string; tone: "red" | "amber" | "primary" | "grey"; items: TodayItem[] };

/** Срок «скоро» — столько дней вперёд (включая сегодня): как сигнал «срок близко» в трекере. */
export const SOON_DAYS = 3;
const DAY = 864e5;
/** Текст действия «вернуть» в журнале трекера (lib/tracker.ts, WORKFLOW_TEXT.return). */
const RETURNED = "возвращена на доработку";
/** Сколько ещё фактов о задаче дописать к пояснению раздела — больше читается хуже. */
const EXTRAS = 2;

const dayOf = (d: string) => {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
};

type Rule = { key: string; title: string; hint: string; tone: TodaySection["tone"]; note: (r: TodayRow) => string | null };

export function buildToday(input: { role: string; meId: string; rows: TodayRow[]; hot: TodayHot; colOf: Map<string, TrackerColumnKey | null>; now: number; events?: TodayEvent[] }): TodaySection[] {
  const { role, meId, hot, colOf } = input;
  const today = mskDay(input.now);
  const head = role === "HEAD";
  const zgd = role === "EXECUTIVE";
  const column = (r: TodayRow) => columnOf(r.statusId, colOf);
  const open = (r: TodayRow) => !r.archived && column(r) !== "DONE" && column(r) !== "HIDDEN";
  const scope = input.rows.filter((r) => open(r) && (!head || r.ownerId === meId));
  const kinds = (r: TodayRow) => hot[r.id]?.kinds ?? [];
  const diff = (r: TodayRow) => (r.deadline ? Math.round((dayOf(r.deadline) - today) / DAY) : null);

  // последнее действие трекера по задаче: «вернули на доработку» — пока её снова не сдали, не поставили на стоп и т. п.
  const lastAction = new Map<string, TodayEvent>();
  for (const e of input.events ?? []) {
    if (e.kind !== "workflow") continue;
    const prev = lastAction.get(e.itemId);
    if (!prev || prev.at <= e.at) lastAction.set(e.itemId, e);
  }

  // факты о задаче: каждый — короткая фраза, null — не про неё
  const deadlineNote = (r: TodayRow) => {
    const d = diff(r);
    if (d === null || d > SOON_DAYS) return null;
    return d < 0 ? `просрочено на ${-d} дн. (срок ${ruDay(r.deadline!)})` : d === 0 ? "срок сегодня" : `срок через ${d} дн. (${ruDay(r.deadline!)})`;
  };
  const stopNote = (r: TodayRow) => (kinds(r).includes("blocker") || r.blockedBy ? (r.blockedBy ? `на стопе: ждём ${r.blockedBy}` : "на стопе") : null);
  const reviewNote = (r: TodayRow) => (column(r) === "REVIEW" ? "сдана на проверку" : null);
  const askedNote = (r: TodayRow) => (kinds(r).includes("request") || r.openRequest ? (zgd ? "ждёт ответа директора" : "ЗГД запросил статус — ответа нет") : null);
  const movesNote = (r: TodayRow) => (kinds(r).includes("deadlineRequest") ? "просят перенести срок — нужно решение" : null);
  const orderName = (r: TodayRow) => `поручение ${r.origin === "ZGD" ? "ЗГД" : "директора"}${r.assignedByName ? ` (${r.assignedByName})` : ""}`;
  const returnedNote = (r: TodayRow) => {
    const e = lastAction.get(r.id);
    if (!e || !e.text.startsWith(RETURNED) || column(r) === "REVIEW") return null;
    const why = e.text.slice(RETURNED.length).replace(/^:\s*/, "").trim();
    return `вернул(а) ${e.who ?? "директор"} ${ruDay(e.at)}${why ? `: ${why}` : ""}`;
  };

  const overdue: Rule = { key: "overdue", title: "Просрочено", hint: "Срок прошёл, задача не выполнена", tone: "red", note: (r) => ((diff(r) ?? 0) < 0 ? deadlineNote(r) : null) };
  const soon: Rule = { key: "soon", title: "Срок скоро", hint: `Сегодня и ближайшие ${SOON_DAYS} дня`, tone: "amber", note: (r) => ((diff(r) ?? -1) >= 0 ? deadlineNote(r) : null) };
  const rules: Rule[] = head
    ? [
        { key: "returned", title: "Вернули на доработку", hint: "Директор вернул с замечанием — исправьте и сдайте снова", tone: "red", note: returnedNote },
        overdue,
        { key: "orders", title: "Поручения: не начаты", hint: "Вам дали поручение — возьмите в работу", tone: "primary", note: (r) => (r.origin && column(r) === "TODO" ? orderName(r) : null) },
        soon,
        { key: "stopped", title: "На стопе", hint: "Ждёте чужого решения или документа", tone: "amber", note: stopNote },
        { key: "review", title: "Ждёт директора", hint: "Сдано на проверку — директор ещё не принял и не вернул", tone: "grey", note: reviewNote },
      ]
    : zgd
      ? [
          { key: "asked", title: "Запросы без ответа", hint: "Вы спросили статус — директор ещё не ответил", tone: "red", note: askedNote },
          overdue,
          soon,
          { key: "orders", title: "Ваши поручения в работе", hint: "Дали вы, ещё не выполнены (просроченные и срочные — выше)", tone: "grey", note: (r) => (r.origin === "ZGD" && r.assignedById === meId ? r.statusName ?? "в работе" : null) },
        ]
      : [
          { key: "review", title: "Ждут вашего решения", hint: "Сданы на проверку — примите или верните", tone: "primary", note: reviewNote },
          { key: "asked", title: "Запросы ЗГД без ответа", hint: "ЗГД спросил статус — ответьте", tone: "red", note: askedNote },
          { key: "moves", title: "Просят перенести срок", hint: "Решение по сроку за вами", tone: "amber", note: movesNote },
          { key: "unassigned", title: "Назначьте ответственного", hint: "Поручение пришло без исполнителя", tone: "red", note: (r) => (r.origin && !r.ownerId ? orderName(r) : null) },
          overdue,
          soon,
        ];

  // что ещё важно о задаче, если она стоит в другом разделе (раздел у задачи один — самый важный для роли)
  const extras = (r: TodayRow, key: string) =>
    [
      key !== "overdue" && key !== "soon" ? deadlineNote(r) : null,
      key !== "review" ? (head && reviewNote(r) ? "сдана — ждёт директора" : reviewNote(r)) : null,
      !head && key !== "asked" && askedNote(r) ? (zgd ? "ваш запрос без ответа" : "ЗГД ждёт ответа") : null,
      !head && !zgd && key !== "moves" && movesNote(r) ? "просят перенести срок" : null,
      key !== "stopped" ? stopNote(r) : null,
      zgd && key !== "orders" && r.origin === "ZGD" && r.assignedById === meId ? "ваше поручение" : null,
    ].filter((x): x is string => !!x);

  const byDeadline = (a: TodayItem, b: TodayItem) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
  const taken = new Set<string>();
  const sections: TodaySection[] = [];
  for (const rule of rules) {
    const items: TodayItem[] = [];
    for (const r of scope) {
      if (taken.has(r.id)) continue;
      const main = rule.note(r);
      if (main === null) continue;
      taken.add(r.id);
      const note = [main, ...extras(r, rule.key).filter((x) => !main.includes(x)).slice(0, EXTRAS)].join(" · ");
      items.push({ id: r.id, name: r.name, ownerName: r.ownerName, deadline: r.deadline, note, ...(zgd ? { directorate: r.directorateName ?? null } : {}) });
    }
    if (items.length) sections.push({ key: rule.key, title: rule.title, hint: rule.hint, tone: rule.tone, items: items.sort(byDeadline) });
  }
  return sections;
}
