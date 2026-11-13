import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Правка и удаление значений справочников (сегменты, статусы, привлекательность) — только админ.
 * Удаляется лишь значение, которое нигде не используется: иначе позиции потеряли бы статус/сегмент/оценку
 * (сначала значение меняют в позициях). Переименование видно сразу во всех позициях.
 */

import { canManageDirectory, canManageSegments } from "@/lib/permissions";
import type { UserRole } from "@prisma/client";

export { PROTECTED_STATUSES } from "@/lib/statuses";

/**
 * Статусы и шкала «Внимание»: общие значения (directorateId пуст) видны всем дирекциям, их ведёт админ;
 * свои значения дирекция добавляет сама (директор, админ в выбранной дирекции) — и видит их только она.
 */
export const visibleTo = (directorateId: string | null | undefined) => (directorateId ? { OR: [{ directorateId: null }, { directorateId }] } : { directorateId: null });

/** Можно ли править значение: общее — админ; своё — тот, кто ведёт справочники дирекции, и только в своей дирекции. */
export function canEditReference(actor: { role: UserRole; directorateId?: string | null }, row: { directorateId: string | null }): boolean {
  if (row.directorateId === null) return canManageDirectory(actor.role);
  return canManageSegments(actor.role) && row.directorateId === (actor.directorateId ?? null);
}

/** Куда добавить новое значение: директор — всегда в свою дирекцию; админ — в общие или (own) в выбранную дирекцию. null — нельзя. */
export function newReferenceScope(actor: { role: UserRole; directorateId?: string | null }, own: boolean): { directorateId: string | null } | null {
  if (canManageDirectory(actor.role) && !own) return { directorateId: null };
  if (canManageSegments(actor.role) && actor.directorateId) return { directorateId: actor.directorateId };
  return null;
}

export const renameSchema = z.object({ name: z.string().trim().min(1, "Название не может быть пустым").max(80, "Название не длиннее 80 символов") });

export const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("ru") === b.trim().toLocaleLowerCase("ru");

export function inUse(count: number, what: string) {
  return NextResponse.json({ error: "IN_USE", count, message: `Нельзя удалить: ${what} используется в позициях (${count}). Сначала поменяйте его в этих позициях.` }, { status: 409 });
}
