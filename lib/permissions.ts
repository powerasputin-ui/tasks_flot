import type { UserRole } from "@prisma/client";

/**
 * Права по ролям. Чистые функции без обращения к БД;
 * сервер проверяет права на КАЖДОМ запросе, интерфейс только отражает их.
 *
 *  - Руководитель (HEAD): видит позиции своей дирекции, правит только те, где он «Ответственный».
 *  - Директор (DIRECTOR ⊇ HEAD): видит и правит всё в своей дирекции, ведёт цикл, отправляет итог ЗГД,
 *    назначает и снимает руководителей своей дирекции.
 *  - Админ (ADMIN ⊇ DIRECTOR, в базе значение CURATOR): то же во всех дирекциях + заводит дирекции, назначает и снимает директоров и ЗГД.
 *  - ЗГД (EXECUTIVE, в базе MANAGEMENT): видит только отправленные итоги дирекций, рабочих позиций не видит.
 *  - Технический администратор (SYSTEM_ADMIN): читает позиции, управляет пользователями и справочниками.
 */
export type Actor = { id: string; role: UserRole; /** Дирекция, в которой работает актор (см. lib/scope.ts). */ directorateId?: string | null };
export type ItemOwnership = { responsibleId: string | null };

/** Директор и админ: «руководящие» роли с правами править всё и вести цикл (директор — в пределах своей дирекции, это проверяет запрос). */
export function isDirectorial(role: string): boolean {
  return role === "DIRECTOR" || role === "ADMIN";
}

/** Кто может быть «Ответственным» за позицию (заполняет и правит свои). */
export function isResponsibleRole(role: UserRole): boolean {
  return role === "HEAD" || isDirectorial(role);
}

export function canViewItems(role: UserRole): boolean {
  return isResponsibleRole(role) || role === "SYSTEM_ADMIN";
}

export function canEditItem(actor: Actor, item: ItemOwnership): boolean {
  if (isDirectorial(actor.role)) return true;
  if (actor.role === "HEAD") return item.responsibleId === actor.id;
  return false;
}

export function canCreateItem(role: UserRole): boolean {
  return isResponsibleRole(role);
}

/**
 * Назначать и менять ответственного на другого человека — директор и админ.
 * Руководитель может лишь оставить ответственным себя (иначе он «отдаст» позицию
 * и потеряет к ней доступ).
 */
export function canAssignResponsible(actor: Actor, responsibleId: string | null | undefined): boolean {
  if (isDirectorial(actor.role)) return true;
  if (actor.role === "HEAD") return responsibleId === actor.id;
  return false;
}

/** Возврат из архива и галка «Опер» — те же границы, что и правка. */
export const canRestoreItem = canEditItem;
export const canSetOperFlag = canEditItem;

/**
 * Удалять (в архив) может только тот, кто заполняет позицию — её ответственный
 * (или автор, пока ответственный не назначен). Директор правит чужие позиции, но не удаляет их.
 */
export function canDeleteItem(actor: Actor, item: { responsibleId: string | null; createdById: string }): boolean {
  if (!isResponsibleRole(actor.role)) return false;
  return item.responsibleId === actor.id || (item.responsibleId === null && item.createdById === actor.id);
}

/** Кто открывает раздел пользователей в настройках. */
export function canManageUsers(role: UserRole): boolean {
  return role === "SYSTEM_ADMIN" || isDirectorial(role);
}

/**
 * Технический администратор и Админ ведут всех пользователей. Директор — только руководителей (роль HEAD)
 * своей дирекции: добавляет, меняет имя и пароль, отключает; роли назначать не может.
 */
export function canManageUser(actor: Actor, targetRole: UserRole): boolean {
  if (actor.role === "SYSTEM_ADMIN" || actor.role === "ADMIN") return true;
  return actor.role === "DIRECTOR" && targetRole === "HEAD";
}

export type RoleChangeError = "FORBIDDEN" | "CANNOT_DEMOTE_SELF" | "LAST_ADMIN";

/**
 * Смена роли пользователя. Технический администратор — любая. Админ — любая между руководителем, директором, ЗГД и админом;
 * нельзя снять роль админа с себя и с последнего активного админа, чтобы система не осталась без админа.
 * Директор роли не меняет. Возвращает код ошибки или null, если можно.
 */
export function checkRoleChange(
  actor: Actor,
  target: { id: string; role: UserRole; isActive: boolean },
  newRole: UserRole,
  activeAdminCount: number
): RoleChangeError | null {
  if (actor.role === "SYSTEM_ADMIN") return null;
  if (actor.role !== "ADMIN") return "FORBIDDEN";
  if (newRole === "SYSTEM_ADMIN" || target.role === "SYSTEM_ADMIN") return "FORBIDDEN";
  if (target.role === "ADMIN" && newRole !== "ADMIN") {
    if (target.id === actor.id) return "CANNOT_DEMOTE_SELF";
    if (target.isActive && activeAdminCount <= 1) return "LAST_ADMIN";
  }
  return null;
}

/** Колонки таблицы (свои поля): директор, админ и технический администратор. */
export function canManageColumns(role: UserRole): boolean {
  return role === "SYSTEM_ADMIN" || isDirectorial(role);
}

/** Треки (справочник «Трек»): те же. */
export function canManageTracks(role: UserRole): boolean {
  return role === "SYSTEM_ADMIN" || isDirectorial(role);
}

/** Общие справочники (статусы, привлекательность) — единый стандарт для всех дирекций: админ и технический администратор. */
export function canManageDirectory(role: UserRole): boolean {
  return role === "SYSTEM_ADMIN" || role === "ADMIN";
}

/** Заводить и переименовывать дирекции, выбирать рабочую дирекцию: админ и технический администратор. */
export function canCreateDirectorates(role: UserRole): boolean {
  return role === "SYSTEM_ADMIN" || role === "ADMIN";
}

/** Сегменты — свои у каждой дирекции: их ведёт директор (в своей дирекции), админ и технический администратор. */
export function canManageSegments(role: UserRole): boolean {
  return role === "SYSTEM_ADMIN" || isDirectorial(role);
}

export function canAccessWorkTable(role: UserRole): boolean {
  return canViewItems(role);
}

/** Excel/PDF рабочей таблицы: руководитель, директор, админ. */
export function canExportWorkTable(role: UserRole): boolean {
  return isResponsibleRole(role);
}
