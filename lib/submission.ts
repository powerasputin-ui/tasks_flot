export type SubmissionEvent = { entityId: string; fieldName: string | null; after: string | null; afterSubmission: boolean; timestamp: Date };

/**
 * «Изменено после отправки» (ТЗ v4, п. 4.4): позиция отправлена куратору (галка «Опер»),
 * а после последней отправки в неё вносились правки. Куратор видит пометку и может открыть историю.
 * События: включение галки (operFlag → true) и правки с afterSubmission=true.
 */
export function idsChangedAfterSubmission(events: SubmissionEvent[]): Set<string> {
  const lastSent = new Map<string, number>();
  for (const e of events) {
    if (e.fieldName === "operFlag" && e.after === "true") {
      lastSent.set(e.entityId, Math.max(lastSent.get(e.entityId) ?? 0, e.timestamp.getTime()));
    }
  }
  const changed = new Set<string>();
  for (const e of events) {
    if (e.afterSubmission && e.timestamp.getTime() > (lastSent.get(e.entityId) ?? 0)) changed.add(e.entityId);
  }
  return changed;
}
