import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Правка и удаление значений справочников (сегменты, статусы, привлекательность) — только админ.
 * Удаляется лишь значение, которое нигде не используется: иначе позиции потеряли бы статус/сегмент/оценку
 * (сначала значение меняют в позициях). Переименование видно сразу во всех позициях.
 */

export { PROTECTED_STATUSES } from "@/lib/statuses";

export const renameSchema = z.object({ name: z.string().trim().min(1, "Название не может быть пустым").max(80, "Название не длиннее 80 символов") });

export const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("ru") === b.trim().toLocaleLowerCase("ru");

export function inUse(count: number, what: string) {
  return NextResponse.json({ error: "IN_USE", count, message: `Нельзя удалить: ${what} используется в позициях (${count}). Сначала поменяйте его в этих позициях.` }, { status: 409 });
}
