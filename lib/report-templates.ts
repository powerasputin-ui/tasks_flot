import type { UserRole } from "@prisma/client";

/**
 * Права на шаблоны отчётов (чистые функции, проверяются на сервере на каждом запросе):
 *  — личный шаблон видит и правит только владелец;
 *  — общий («для всех») видят все, создаёт куратор или администратор; править и удалять его могут
 *    куратор и администратор (и владелец, пока он куратор/администратор).
 */
export type TemplateAccess = { ownerId: string; scope: "PERSONAL" | "SHARED"; directorateId?: string | null };
type Actor = { id: string; role: UserRole; directorateId?: string | null };

/** Общий шаблон принадлежит дирекции: чужой дирекции он «не существует». */
const sameDirectorate = (actor: Actor, t: TemplateAccess) => !!actor.directorateId && t.directorateId === actor.directorateId;

/** Кто вообще может строить отчёты и хранить шаблоны. */
export function canUseReports(role: UserRole): boolean {
  return role === "DIRECTOR" || role === "ADMIN" || role === "SYSTEM_ADMIN";
}

export function canShareTemplates(role: string): boolean {
  return role === "DIRECTOR" || role === "ADMIN" || role === "SYSTEM_ADMIN";
}

export function canViewTemplate(actor: Actor, t: TemplateAccess): boolean {
  return canUseReports(actor.role) && (t.scope === "SHARED" ? sameDirectorate(actor, t) : t.ownerId === actor.id);
}

export function canEditTemplate(actor: Actor, t: TemplateAccess): boolean {
  if (!canUseReports(actor.role)) return false;
  if (t.scope === "SHARED") return canShareTemplates(actor.role) && sameDirectorate(actor, t);
  return t.ownerId === actor.id;
}
