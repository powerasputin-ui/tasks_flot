/**
 * «Трекер» ЗГД — только подтверждённое директором. ЗГД рабочей таблицы не видит. Подтверждённое состояние задачи берётся
 * из двух источников, по времени:
 *  - отправленная справка — снимок всей таблицы дирекции на день отправки (memo_versions.rows);
 *  - решение директора по задаче (принял, вернул, отменил, ответил на запрос ЗГД, согласовал перенос, «Обновить для ЗГД») —
 *    снимок одной задачи (item_publications).
 * Доска — последнее подтверждённое состояние каждой задачи; история — чем соседние подтверждения отличаются.
 * Права не расширяются: черновики дирекции до подтверждения ЗГД не видны. Чистые функции, без базы.
 */
import type { ArchiveRow } from "@/lib/archive-table";
import { ruDay, type TrackerColumnKey, type TrackerEvent } from "@/lib/tracker";

export type SentVersion = { directorateId: string; directorateName: string; sentAt: Date | string; title: string; rows: ArchiveRow[] };

/** Подтверждение директора по одной задаче (снимок полей — lib/workflow-server.ts PublishedSnapshot). */
export type Publication = {
  itemId: string;
  directorateId: string;
  directorateName: string;
  at: Date | string;
  who: string;
  reason: string;
  state: Partial<SentState> & { name: string };
};

/** Подтверждённое состояние задачи (общие поля снимка справки и подтверждения директора). */
export type SentState = {
  segmentId: string | null;
  segmentName: string | null;
  trackName: string | null;
  name: string;
  comment: string | null;
  ownerName: string | null;
  statusName: string | null;
  statusColor: string | null;
  deadline: string | null;
  submitted: boolean;
  inMemo: boolean;
  expectedResult: string | null;
  originalDeadline: string | null;
  blockedBy: string | null;
  blockedUntil: string | null;
  cancelReason: string | null;
  origin: string | null;
  zgdControl: boolean;
  review: { result: string; decision: string | null; decidedByName: string | null; comment: string | null } | null;
};

/** Строка трекера ЗГД: подтверждённое состояние + когда и кем подтверждено. */
export type SentRow = SentState & {
  id: string;
  directorateId: string;
  directorateName: string;
  /** Когда подтверждено это состояние (справка или решение директора). */
  asOf: string;
  /** Чем подтверждено: «справка от 13.10.26» или «Сухов В.А.: принять». */
  confirmedBy: string;
};

const DAY = 24 * 3600 * 1000;
const iso = (d: Date | string) => new Date(d).toISOString();
const sameDay = (a: string | null, b: string | null) => (a ? a.slice(0, 10) : null) === (b ? b.slice(0, 10) : null);

const EMPTY: Omit<SentState, "name"> = {
  segmentId: null, segmentName: null, trackName: null, comment: null, ownerName: null, statusName: null, statusColor: null, deadline: null,
  submitted: false, inMemo: false, expectedResult: null, originalDeadline: null, blockedBy: null, blockedUntil: null, cancelReason: null,
  origin: null, zgdControl: false, review: null,
};
const fromRow = (r: ArchiveRow): SentState => ({ ...EMPTY, segmentId: r.segmentId, segmentName: r.segmentName, trackName: r.trackName, name: r.name, comment: r.comment, ownerName: r.ownerName, statusName: r.statusName, statusColor: r.statusColor, deadline: r.deadline, submitted: r.submitted, inMemo: r.inMemo });

/** Что изменилось между двумя подтверждёнными состояниями — события истории ЗГД. */
function diff(itemId: string, p: SentState, r: SentState, at: string, who: string, out: TrackerEvent[]) {
  const ev = (kind: TrackerEvent["kind"], text: string, slip?: number, before?: string | null, after?: string | null) =>
    out.push({ itemId, at, kind, who, text, ...(slip ? { slip } : {}), ...(before !== undefined || after !== undefined ? { before: before ?? null, after: after ?? null } : {}) });
  if ((p.statusName ?? null) !== (r.statusName ?? null)) ev("status", `статус: ${p.statusName ?? "без статуса"} → ${r.statusName ?? "без статуса"}`, undefined, p.statusName, r.statusName);
  if (!sameDay(p.deadline, r.deadline)) {
    const slip = p.deadline && r.deadline ? Math.round((new Date(r.deadline).getTime() - new Date(p.deadline).getTime()) / DAY) : 0;
    ev("deadline", !p.deadline ? `назначен срок ${ruDay(r.deadline!)}` : !r.deadline ? `срок снят (был ${ruDay(p.deadline)})` : `срок: ${ruDay(p.deadline)} → ${ruDay(r.deadline)}${slip ? ` (${slip > 0 ? "+" : ""}${slip} дн.)` : ""}`, slip > 0 ? slip : undefined, p.deadline, r.deadline);
  }
  if ((p.ownerName ?? null) !== (r.ownerName ?? null)) ev("owner", `ответственный: ${p.ownerName ?? "не назначен"} → ${r.ownerName ?? "не назначен"}`, undefined, p.ownerName, r.ownerName);
  if (p.name !== r.name || (p.comment ?? "") !== (r.comment ?? "")) ev("text", "обновлён текст задачи");
  if (!p.submitted && r.submitted) ev("submitted", "подана в справку");
  if (!p.blockedBy && r.blockedBy) ev("workflow", `заблокирована: ждём ${r.blockedBy}`);
  if (p.blockedBy && !r.blockedBy) ev("workflow", "блок снят");
}

/**
 * Трекер ЗГД из справок и подтверждений директора. rows — последнее подтверждённое состояние каждой задачи;
 * events — изменения между подтверждениями; since — с какого подтверждения известна история.
 */
export function buildZgdTracker(versions: SentVersion[], publications: Publication[] = []): { rows: SentRow[]; events: TrackerEvent[]; since: string | null } {
  type Src = { at: string; memo?: SentVersion; pub?: Publication };
  const sources: Src[] = [
    ...versions.filter((v) => v.rows.length).map((v) => ({ at: iso(v.sentAt), memo: v })), // у старых промежуточных ревизий таблицы нет — пропускаем
    ...publications.map((p) => ({ at: iso(p.at), pub: p })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const cur = new Map<string, { state: SentState; directorateId: string; directorateName: string; asOf: string; confirmedBy: string }>();
  const seenDir = new Set<string>();
  const events: TrackerEvent[] = [];
  for (const s of sources) {
    if (s.memo) {
      const v = s.memo;
      const day = ruDay(v.sentAt);
      const who = `справка от ${day}`;
      const first = !seenDir.has(v.directorateId);
      seenDir.add(v.directorateId);
      const ids = new Set(v.rows.map((r) => r.id));
      for (const r of v.rows) {
        const state = fromRow(r);
        const p = cur.get(r.id);
        if (!p) events.push({ itemId: r.id, at: s.at, kind: "created", who, text: first ? `в таблице на ${day} — с этой справки известна история` : `появилась в таблице (справка от ${day})` });
        else diff(r.id, p.state, state, s.at, who, events);
        if (r.inMemo) events.push({ itemId: r.id, at: s.at, kind: "memo", who, text: `вошла в отправленную справку «${v.title}»` });
        // поля поручения справка не несёт — оставляем подтверждённые директором
        cur.set(r.id, { state: p ? { ...p.state, ...state, expectedResult: p.state.expectedResult, originalDeadline: p.state.originalDeadline, blockedBy: p.state.blockedBy, blockedUntil: p.state.blockedUntil, cancelReason: p.state.cancelReason, origin: p.state.origin, zgdControl: p.state.zgdControl, review: p.state.review } : state, directorateId: v.directorateId, directorateName: v.directorateName, asOf: s.at, confirmedBy: who });
      }
      for (const [id, c] of cur) {
        if (c.directorateId === v.directorateId && !ids.has(id)) {
          events.push({ itemId: id, at: s.at, kind: "archived", who, text: `нет в таблице на ${day} (удалена)` });
          cur.delete(id);
        }
      }
    } else if (s.pub) {
      const p = s.pub;
      const state: SentState = { ...EMPTY, ...(cur.get(p.itemId)?.state ?? {}), ...p.state };
      const prev = cur.get(p.itemId);
      const who = p.who;
      if (prev) diff(p.itemId, prev.state, state, s.at, who, events);
      const rv = state.review;
      const why = rv?.comment && (p.reason.startsWith("вернул") || p.reason.startsWith("принял")) ? ` — ${rv.comment}` : state.cancelReason && p.reason.startsWith("отменил") ? ` — ${state.cancelReason}` : "";
      events.push({ itemId: p.itemId, at: s.at, kind: prev ? "workflow" : "created", who, text: `${p.reason}${why}` });
      cur.set(p.itemId, { state, directorateId: p.directorateId, directorateName: p.directorateName, asOf: s.at, confirmedBy: `${p.who}: ${p.reason}` });
    }
  }
  const rows: SentRow[] = [...cur].map(([id, c]) => ({ id, ...c.state, directorateId: c.directorateId, directorateName: c.directorateName, asOf: c.asOf, confirmedBy: c.confirmedBy }));
  return { rows, events, since: sources[0]?.at ?? null };
}

/** Только справки (без подтверждений директора) — прежнее поведение. */
export const buildSentTracker = (versions: SentVersion[]) => buildZgdTracker(versions, []);

/** Колонка доски по названию статуса из снимка (статусы в снимке — названиями). */
export function columnByName(statusName: string | null, columns: Map<string, TrackerColumnKey | null>): TrackerColumnKey {
  return (statusName ? columns.get(statusName) : null) ?? "TODO";
}
