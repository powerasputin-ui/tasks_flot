import type { Actor } from "@/lib/permissions";

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

/** Финальный итог доступен ЗГД (всех дирекций) и участникам своей дирекции. */
export function canViewFinalCycle(actor: Actor, cycle: { directorateId: string | null }): boolean {
  return actor.role === "EXECUTIVE" || isInScope(actor, cycle);
}
