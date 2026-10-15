/**
 * Жизненный цикл задачи в «Трекере» (формальная приёмка). Чистые функции: какие действия кому доступны и что они требуют.
 * Сделать → В работе → «Сдать на проверку» (результат) → На проверке → «Принять» (директор) → Выполнено
 *                                                                     → «Вернуть» (директор, причина) → В работе
 * Из любого невыполненного: «Заблокировать» (на чём ждём, до какой даты) / «Снять блок»; «Отменить» (директор, причина).
 * Выполнено / Отменено → «Переоткрыть» (директор, причина).
 * Статусы «На проверке», «Выполнено», «Не актуально» напрямую не ставятся — только этими действиями (сервер, lib/items.ts).
 */
import { isDirectorial, type Actor } from "@/lib/permissions";
import type { TrackerColumnKey } from "@/lib/tracker";

export type WorkflowAction = "submit" | "accept" | "return" | "block" | "unblock" | "cancel" | "reopen";

export const ACTION_LABEL: Record<WorkflowAction, string> = {
  submit: "Сдать на проверку",
  accept: "Принять",
  return: "Вернуть на доработку",
  block: "Заблокировано",
  unblock: "Снять блок",
  cancel: "Отменить (не актуально)",
  reopen: "Переоткрыть",
};

/** Решение директора словами — для подтверждения ЗГД и его истории. */
export const DECISION_TEXT: Record<WorkflowAction, string> = {
  submit: "сдал(а) на проверку",
  accept: "принял(а) задачу",
  return: "вернул(а) на доработку",
  block: "отметил(а) блокер",
  unblock: "снял(а) блок",
  cancel: "отменил(а) задачу",
  reopen: "переоткрыл(а) задачу",
};

/** Колонки, в которые задача попадает только действием (не прямой сменой статуса). */
export const WORKFLOW_COLUMNS: TrackerColumnKey[] = ["REVIEW", "DONE", "HIDDEN"];

export type WorkflowItem = { column: TrackerColumnKey; responsibleId: string | null; createdById: string; blocked: boolean; archived: boolean };
export type WorkflowInput = { result?: string; comment?: string; blockedBy?: string; reason?: string };

const MIN_TEXT = 5;
const filled = (s: string | undefined, min = MIN_TEXT) => !!s && s.trim().length >= min;

/** Может ли человек менять задачу как исполнитель (ответственный, или автор без ответственного) или как директор/админ. */
function isExecutor(actor: Pick<Actor, "id" | "role">, item: WorkflowItem): boolean {
  return isDirectorial(actor.role) || (actor.role === "HEAD" && (item.responsibleId === actor.id || (!item.responsibleId && item.createdById === actor.id)));
}

/** Доступные действия (для кнопок): права + текущее состояние. */
export function availableActions(actor: Pick<Actor, "id" | "role">, item: WorkflowItem): WorkflowAction[] {
  return (Object.keys(ACTION_LABEL) as WorkflowAction[]).filter((a) => checkAction(actor, item, a, null) === null);
}

/**
 * null — можно; иначе — понятная причина отказа. input=null — проверяем только права и состояние (без полей диалога).
 */
export function checkAction(actor: Pick<Actor, "id" | "role">, item: WorkflowItem, action: WorkflowAction, input: WorkflowInput | null): string | null {
  if (item.archived) return "Задача удалена — сначала верните её из «Удалённых».";
  const director = isDirectorial(actor.role);
  const open = item.column === "TODO" || item.column === "DOING";
  switch (action) {
    case "submit":
      if (!isExecutor(actor, item)) return "Сдать на проверку может ответственный за задачу или директор.";
      if (!open) return item.column === "REVIEW" ? "Задача уже на проверке." : "Сдавать можно задачу в работе.";
      if (input && !filled(input.result)) return "Опишите результат: что сделано и где это посмотреть.";
      return null;
    case "accept":
    case "return":
      if (!director) return "Принимает и возвращает задачи директор.";
      // свою же работу не принимают: админ, который сам ведёт позиции, сдаёт их директору
      if (item.responsibleId === actor.id && actor.role !== "DIRECTOR") return "Свою задачу принимает директор дирекции.";
      if (item.column !== "REVIEW") return "Принять или вернуть можно задачу, сданную на проверку.";
      if (action === "return" && input && !filled(input.comment)) return "Напишите, что нужно доработать.";
      return null;
    case "block":
      if (!isExecutor(actor, item)) return "Заблокировать может ответственный за задачу или директор.";
      if (!open) return "Заблокировать можно задачу в работе.";
      if (item.blocked) return "Задача уже заблокирована.";
      if (input && !filled(input.blockedBy, 3)) return "Укажите, на чём ждём (чьё решение, документ, поставка).";
      return null;
    case "unblock":
      if (!isExecutor(actor, item)) return "Снять блок может ответственный за задачу или директор.";
      if (!item.blocked) return "Задача не заблокирована.";
      return null;
    case "cancel":
      if (!director) return "Отменить задачу может директор.";
      if (item.column === "DONE" || item.column === "HIDDEN") return "Задача уже закрыта.";
      if (input && !filled(input.reason)) return "Укажите причину отмены.";
      return null;
    case "reopen":
      if (!director) return "Переоткрыть задачу может директор.";
      if (item.column !== "DONE" && item.column !== "HIDDEN") return "Переоткрыть можно выполненную или отменённую задачу.";
      if (input && !filled(input.reason)) return "Укажите, почему задача снова в работе.";
      return null;
  }
}

/** Колонка, в которую ведёт действие (статус — первый статус этой колонки, lib/tracker.ts statusForColumn). */
export const TARGET_COLUMN: Partial<Record<WorkflowAction, TrackerColumnKey>> = { submit: "REVIEW", accept: "DONE", return: "DOING", cancel: "HIDDEN", reopen: "DOING" };

/**
 * Прямая смена статуса (таблица, карточка, перетаскивание без диалога): в колонки и из колонок приёмки — нельзя.
 * Руководитель «Сделать ↔ В работе» меняет как раньше.
 */
export function directStatusError(from: TrackerColumnKey, to: TrackerColumnKey): string | null {
  if (from === to) return null;
  if (WORKFLOW_COLUMNS.includes(to)) return to === "REVIEW" ? "Чтобы отправить на проверку, нажмите «Сдать на проверку» и опишите результат." : to === "DONE" ? "Выполненной задачу делает директор — кнопкой «Принять» после сдачи на проверку." : "Отменяет задачу директор — кнопкой «Отменить» с причиной.";
  if (WORKFLOW_COLUMNS.includes(from)) return from === "REVIEW" ? "Задача на проверке: директор принимает её или возвращает с замечанием." : "Закрытую задачу возвращает в работу директор — кнопкой «Переоткрыть» с причиной.";
  return null;
}

/** Перенос срока: всегда с причиной; у поручения ЗГД и задачи на контроле ЗГД руководитель только просит (решает директор). */
export function deadlineChangeError(actor: Pick<Actor, "role">, item: { deadline: Date | null; zgdControl: boolean; origin: string | null }, next: Date | null, reason: string | undefined): string | null {
  const before = item.deadline ? item.deadline.toISOString().slice(0, 10) : null;
  const after = next ? next.toISOString().slice(0, 10) : null;
  if (before === after || before === null) return null; // первый срок ставится свободно
  if (!isDirectorial(actor.role) && (item.zgdControl || !!item.origin)) return item.zgdControl || item.origin === "ZGD" ? "Срок этой задачи под контролем ЗГД: запросите перенос — решение примет директор." : "Срок поручения директора: запросите перенос — решение примет директор.";
  if (!filled(reason, 3)) return "Укажите причину переноса срока.";
  return null;
}
