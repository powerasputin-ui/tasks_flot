import type { UserRole } from "@prisma/client";

/**
 * Права по ролям. Чистые функции без обращения к БД;
 * сервер проверяет права на КАЖДОМ запросе, интерфейс только отражает их.
 *
 *  - Руководитель (HEAD): видит все позиции, правит только те, где он «Ответственный».
 *  - Куратор (CURATOR ⊇ HEAD): видит и правит всё.
 *  - Руководство (MANAGEMENT): видит только финальные оперативки (этап 4), рабочих позиций не видит.
 *  - Администратор (SYSTEM_ADMIN): читает позиции, управляет пользователями и справочниками.
 */
export type Actor = { id: string; role: UserRole };
export type ItemOwnership = { responsibleId: string | null };

export function canViewItems(role: UserRole): boolean {
  return role === "HEAD" || role === "CURATOR" || role === "SYSTEM_ADMIN";
}

export function canEditItem(actor: Actor, item: ItemOwnership): boolean {
  if (actor.role === "CURATOR") return true;
  if (actor.role === "HEAD") return item.responsibleId === actor.id;
  return false;
}

export function canCreateItem(role: UserRole): boolean {
  return role === "HEAD" || role === "CURATOR";
}

/**
 * Назначать и менять ответственного на другого человека — только куратор.
 * Руководитель может лишь оставить ответственным себя (иначе он «отдаст» позицию
 * и потеряет к ней доступ).
 */
export function canAssignResponsible(actor: Actor, responsibleId: string | null | undefined): boolean {
  if (actor.role === "CURATOR") return true;
  if (actor.role === "HEAD") return responsibleId === actor.id;
  return false;
}

/** Возврат из архива и галка «Опер» — те же границы, что и правка. */
export const canRestoreItem = canEditItem;
export const canSetOperFlag = canEditItem;

/**
 * Удалять (в архив) может только тот, кто заполняет позицию — её ответственный
 * (или автор, пока ответственный не назначен). Куратор правит чужие позиции, но не удаляет их.
 */
export function canDeleteItem(actor: Actor, item: { responsibleId: string | null; createdById: string }): boolean {
  if (actor.role !== "HEAD" && actor.role !== "CURATOR") return false;
  return item.responsibleId === actor.id || (item.responsibleId === null && item.createdById === actor.id);
}

/** Пользователи и справочники — только SYSTEM_ADMIN. */
export function canManageDirectory(role: UserRole): boolean {
  return role === "SYSTEM_ADMIN";
}

export function canAccessWorkTable(role: UserRole): boolean {
  return canViewItems(role);
}

/** Excel/PDF рабочей таблицы: руководитель и куратор. */
export function canExportWorkTable(role: UserRole): boolean {
  return role === "HEAD" || role === "CURATOR";
}
