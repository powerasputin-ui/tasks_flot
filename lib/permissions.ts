import type { UserRole } from "@prisma/client";

/**
 * Права по ролям — TZ_v4.md, раздел 6. Чистые функции без обращения к БД.
 * Сервер проверяет права на КАЖДОМ запросе (интерфейс только отражает их).
 *
 * Куратор ⊇ руководитель подразделения: всё, что может руководитель отдела,
 * куратор может для любого отдела. Руководство видит только финальные
 * оперативки (этап 4), рабочих позиций не видит. Админ — только чтение позиций.
 */
export type Actor = { id: string; role: UserRole; departmentId: string | null };
export type ItemScope = { departmentId: string };

const isHead = (a: Actor) => a.role === "DEPARTMENT_HEAD";
const isCurator = (a: Actor) => a.role === "CURATOR";

export function canViewAllDepartments(role: UserRole): boolean {
  return role === "CURATOR" || role === "SYSTEM_ADMIN";
}

export function canViewItem(actor: Actor, item: ItemScope): boolean {
  if (canViewAllDepartments(actor.role)) return true;
  if (isHead(actor)) return !!actor.departmentId && actor.departmentId === item.departmentId;
  return false; // MANAGEMENT: только финальные снимки
}

export function canEditItem(actor: Actor, item: ItemScope): boolean {
  if (isCurator(actor)) return true;
  if (isHead(actor)) return !!actor.departmentId && actor.departmentId === item.departmentId;
  return false;
}

export function canCreateItem(actor: Actor, departmentId: string): boolean {
  return canEditItem(actor, { departmentId });
}

/** Архивирование и возврат из архива, галка «Опер» — те же границы, что и правка. */
export const canArchiveItem = canEditItem;
export const canSetOperFlag = canEditItem;

/** Пользователи, подразделения, справочники — только SYSTEM_ADMIN (раздел 6). */
export function canManageDirectory(role: UserRole): boolean {
  return role === "SYSTEM_ADMIN";
}

export function canAccessWorkTable(role: UserRole): boolean {
  return role === "DEPARTMENT_HEAD" || role === "CURATOR" || role === "SYSTEM_ADMIN";
}

/** Excel/PDF рабочей таблицы: руководитель отдела (свой отдел), куратор. */
export function canExportWorkTable(role: UserRole): boolean {
  return role === "DEPARTMENT_HEAD" || role === "CURATOR";
}

/**
 * Prisma-условие видимости позиций для актора. null = доступа нет вообще.
 * Руководитель без подразделения не видит ничего (а не «все»).
 */
export function itemVisibilityWhere(actor: Actor): { departmentId?: string } | null {
  if (canViewAllDepartments(actor.role)) return {};
  if (isHead(actor)) return actor.departmentId ? { departmentId: actor.departmentId } : null;
  return null;
}
