/**
 * «Трекер» ЗГД — по отправленным справкам. ЗГД рабочей таблицы не видит, но с каждой справкой сохраняется снимок
 * всей таблицы дирекции на день отправки (memo_versions.rows). Доска — состояние на последнюю справку дирекции,
 * история — чем снимки соседних справок отличаются (статус, срок, ответственный, текст, вошла ли в справку).
 * Права не расширяются: ЗГД видит ровно то, что ему отправляли. Чистые функции, без базы.
 */
import type { ArchiveRow } from "@/lib/archive-table";
import { ruDay, type TrackerColumnKey, type TrackerEvent } from "@/lib/tracker";

export type SentVersion = { directorateId: string; directorateName: string; sentAt: Date | string; title: string; rows: ArchiveRow[] };

/** Строка трекера ЗГД: как строка таблицы, но из снимка (только чтение). */
export type SentRow = {
  id: string;
  directorateId: string;
  directorateName: string;
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
  /** Дата справки, на которую показано состояние. */
  asOf: string;
};

const DAY = 24 * 3600 * 1000;
const iso = (d: Date | string) => new Date(d).toISOString();
const sameDay = (a: string | null, b: string | null) => (a ? a.slice(0, 10) : null) === (b ? b.slice(0, 10) : null);

/** Доска и история по снимкам: rows — состояние на последнюю справку каждой дирекции; events — изменения между справками. */
export function buildSentTracker(versions: SentVersion[]): { rows: SentRow[]; events: TrackerEvent[]; since: string | null } {
  const sorted = [...versions].sort((a, b) => iso(a.sentAt).localeCompare(iso(b.sentAt)));
  const prevByDir = new Map<string, Map<string, ArchiveRow>>();
  const lastByDir = new Map<string, { v: SentVersion; rows: ArchiveRow[] }>();
  const events: TrackerEvent[] = [];
  for (const v of sorted) {
    if (!v.rows.length) continue; // у старых промежуточных ревизий таблицы нет — пропускаем, а не считаем «всё удалили»
    const at = iso(v.sentAt);
    const day = ruDay(v.sentAt);
    const prev = prevByDir.get(v.directorateId);
    const who = `справка от ${day}`;
    const cur = new Map(v.rows.map((r) => [r.id, r]));
    for (const r of v.rows) {
      const p = prev?.get(r.id);
      const ev = (kind: TrackerEvent["kind"], text: string, slip?: number, before?: string | null, after?: string | null) =>
        events.push({ itemId: r.id, at, kind, who, text, ...(slip ? { slip } : {}), ...(before !== undefined || after !== undefined ? { before: before ?? null, after: after ?? null } : {}) });
      if (!p) ev("created", prev ? `появилась в таблице (справка от ${day})` : `в таблице на ${day} — с этой справки известна история`);
      else {
        if ((p.statusName ?? null) !== (r.statusName ?? null)) ev("status", `статус: ${p.statusName ?? "без статуса"} → ${r.statusName ?? "без статуса"}`, undefined, p.statusName, r.statusName);
        if (!sameDay(p.deadline, r.deadline)) {
          const slip = p.deadline && r.deadline ? Math.round((new Date(r.deadline).getTime() - new Date(p.deadline).getTime()) / DAY) : 0;
          ev("deadline", !p.deadline ? `назначен срок ${ruDay(r.deadline!)}` : !r.deadline ? `срок снят (был ${ruDay(p.deadline)})` : `срок: ${ruDay(p.deadline)} → ${ruDay(r.deadline)}${slip ? ` (${slip > 0 ? "+" : ""}${slip} дн.)` : ""}`, slip > 0 ? slip : undefined, p.deadline, r.deadline);
        }
        if ((p.ownerName ?? null) !== (r.ownerName ?? null)) ev("owner", `ответственный: ${p.ownerName ?? "не назначен"} → ${r.ownerName ?? "не назначен"}`, undefined, p.ownerName, r.ownerName);
        if (p.name !== r.name || (p.comment ?? "") !== (r.comment ?? "")) ev("text", "обновлён текст задачи");
        if (!p.submitted && r.submitted) ev("submitted", "подана в справку");
      }
      if (r.inMemo) ev("memo", `вошла в отправленную справку «${v.title}»`);
    }
    for (const [id] of prev ?? []) if (!cur.has(id)) events.push({ itemId: id, at, kind: "archived", who, text: `нет в таблице на ${day} (удалена)` });
    prevByDir.set(v.directorateId, cur);
    lastByDir.set(v.directorateId, { v, rows: v.rows });
  }
  const rows: SentRow[] = [];
  for (const { v, rows: list } of lastByDir.values()) {
    for (const r of list) {
      rows.push({
        id: r.id,
        directorateId: v.directorateId,
        directorateName: v.directorateName,
        segmentId: r.segmentId,
        segmentName: r.segmentName,
        trackName: r.trackName,
        name: r.name,
        comment: r.comment,
        ownerName: r.ownerName,
        statusName: r.statusName,
        statusColor: r.statusColor,
        deadline: r.deadline,
        submitted: r.submitted,
        inMemo: r.inMemo,
        asOf: iso(v.sentAt),
      });
    }
  }
  const first = sorted.find((v) => v.rows.length);
  return { rows, events, since: first ? iso(first.sentAt) : null };
}

/** Колонка доски по названию статуса из снимка (статусы в снимке — названиями). */
export function columnByName(statusName: string | null, columns: Map<string, TrackerColumnKey | null>): TrackerColumnKey {
  return (statusName ? columns.get(statusName) : null) ?? "TODO";
}
