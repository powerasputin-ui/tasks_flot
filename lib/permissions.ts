import type { UserRole } from "@prisma/client";

/**
 * Права по ролям — разделы 35-38 ТЗ.
 *
 * ВАЖНО: раздел 39 явно запрещает угадывать ряд правил:
 *  - кто может менять чужой Track/Task,
 *  - кто может архивировать Track,
 *  - может ли Руководитель менять Task.
 *
 * Пока эти правила не подтверждены бизнес-заказчиком, здесь применяется
 * консервативный дефолт: Ответственный может UPDATE/ARCHIVE только объекты,
 * где ownerId === его userId (включая случай ownerId = NULL — доступ на
 * запись не выдаётся автоматически, раздел 38). Это UNRESOLVED BUSINESS RULE,
 * см. TZ.md раздел 39 и README.md, не финальное решение.
 */

export type WorkEntity = { ownerId: string | null };

export function canReadAll(_role: UserRole): boolean {
  // Раздел 35/36/37: READ доступен всем ролям по всей системе.
  return true;
}

export function canCreateWorkEntity(role: UserRole): boolean {
  // Раздел 35: Ответственный создаёт Track/Task/VesselOption.
  // Куратор/Руководитель не создают рабочие сущности в Phase 1 (не описано в ТЗ).
  return role === "RESPONSIBLE";
}

export function canUpdateWorkEntity(role: UserRole, userId: string, entity: WorkEntity): boolean {
  if (role === "RESPONSIBLE") {
    return entity.ownerId === userId; // UNRESOLVED BUSINESS RULE default, см. выше
  }
  return false;
}

export function canArchiveWorkEntity(role: UserRole, userId: string, entity: WorkEntity): boolean {
  // Раздел 39: "кто может архивировать Track" не подтверждено.
  // Дефолт: та же граница, что и для UPDATE.
  return canUpdateWorkEntity(role, userId, entity);
}

export function canManageReferenceData(role: UserRole): boolean {
  // Раздел 36: Куратор управляет Segment/Attractiveness/Status.
  return role === "CURATOR";
}

export function canSetOperFlag(role: UserRole): boolean {
  // Раздел 17/36: изменять operFlag может Куратор.
  return role === "CURATOR";
}

export function canAccessManagerViews(role: UserRole): boolean {
  // Раздел 37: Dashboard/Digest/Export — доступ Руководителя (и Куратора/Ответственного тоже можно читать).
  return role === "MANAGER" || role === "CURATOR";
}
