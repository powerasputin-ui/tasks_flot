import { canCompileMemo, type Actor } from "@/lib/permissions";

/**
 * Границы дирекции. Все живые данные (позиции, сегменты, треки, циклы, колонки, люди) принадлежат дирекции,
 * и КАЖДЫЙ запрос ограничивается дирекцией из сессии на сервере. Здесь — единое место, а не проверки вразброс.
 *
 * Дирекция актора: у руководителя и директора своя; у админа — выбранная им (кука), иначе «домашняя», иначе первая.
 * У ЗГД дирекции нет и живых данных он не видит — только отправленные итоги.
 */
export class ScopeError extends Error {
  constructor() {
    super("NO_DIRECTORATE");
    this.name = "ScopeError";
  }
}

/** Дирекция актора или ошибка (у ЗГД и у неприкреплённого пользователя её нет). */
export function requireDirectorate(actor: { directorateId?: string | null }): string {
  if (!actor.directorateId) throw new ScopeError();
  return actor.directorateId;
}

/** Условие для запросов: `where: { ...inDirectorate(actor), ... }`. */
export function inDirectorate(actor: Actor): { directorateId: string } {
  return { directorateId: requireDirectorate(actor) };
}

/** Запись доступна актору, только если принадлежит его дирекции. */
export function isInScope(actor: Actor, record: { directorateId: string | null }): boolean {
  return !!actor.directorateId && record.directorateId === actor.directorateId;
}

/**
 * Единое правило «кто видит отправленное» — справку, что в неё вошло, итог оперативки:
 * ЗГД (все дирекции), а в своей дирекции — те, кто ведёт справку (директор, админ, назначенный составитель) и тех. админ.
 * Руководитель, который только заполняет таблицу, отправленного не видит: в неделях ему показывается лишь «подано».
 */
export function canSeeSent(actor: Actor, directorateId: string | null): boolean {
  if (actor.role === "EXECUTIVE") return true;
  return (canCompileMemo(actor) || actor.role === "SYSTEM_ADMIN") && isInScope(actor, { directorateId });
}

/** Итог оперативки (старый формат, файл, отчёт) — то же правило. */
export function canViewFinalCycle(actor: Actor, cycle: { directorateId: string | null }): boolean {
  return canSeeSent(actor, cycle.directorateId);
}
