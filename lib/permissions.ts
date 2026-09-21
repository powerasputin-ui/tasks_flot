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

/** Кто открывает раздел пользователей в настройках. */
export function canManageUsers(role: UserRole): boolean {
  return role === "SYSTEM_ADMIN" || role === "CURATOR";
}

/**
 * Администратор ведёт всех пользователей. Куратор — только «ответственных»
 * (роль HEAD): добавляет, меняет имя и пароль, отключает; роли назначать не может.
 */
export function canManageUser(actor: Actor, targetRole: UserRole): boolean {
  if (actor.role === "SYSTEM_ADMIN") return true;
  return actor.role === "CURATOR" && targetRole === "HEAD";
}

export type RoleChangeError = "FORBIDDEN" | "CANNOT_DEMOTE_SELF" | "LAST_CURATOR";

/**
 * Смена роли пользователя. Администратор — любая. Куратор — только пара «руководитель ↔ куратор»:
 * назначить руководителя куратором или снять другого куратора (остаться руководителем). Нельзя снять себя
 * и нельзя снять последнего активного куратора, чтобы система не осталась без куратора.
 * Возвращает код ошибки или null, если можно.
 */
export function checkRoleChange(
  actor: Actor,
  target: { id: string; role: UserRole; isActive: boolean },
  newRole: UserRole,
  activeCuratorCount: number
): RoleChangeError | null {
  if (actor.role === "SYSTEM_ADMIN") return null;
  if (actor.role !== "CURATOR") return "FORBIDDEN";
  if (target.role === "HEAD" && newRole === "CURATOR") return null; // назначить куратором
  if (target.role === "CURATOR" && newRole === "HEAD") {
    if (target.id === actor.id) return "CANNOT_DEMOTE_SELF";
    if (target.isActive && activeCuratorCount <= 1) return "LAST_CURATOR";
    return null; // снять с кураторства
  }
  return "FORBIDDEN"; // остальные роли куратор не назначает и не снимает
}

/** Колонки таблицы (свои поля): создаёт и удаляет куратор; администратор — тоже. */
export function canManageColumns(role: UserRole): boolean {
  return role === "SYSTEM_ADMIN" || role === "CURATOR";
}

/** Треки (справочник «Трек»): добавляют, меняют и удаляют куратор и администратор. */
export function canManageTracks(role: UserRole): boolean {
  return role === "SYSTEM_ADMIN" || role === "CURATOR";
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
