import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/permissions";

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new AuthError("UNAUTHENTICATED");
  return session;
}

/**
 * Актор для проверок прав: роль берётся из БД на каждом запросе
 * (а не из токена), чтобы смена роли админом действовала сразу, а
 * деактивированный пользователь терял доступ немедленно.
 */
// Проверка пользователя в базе стоит целого обмена с базой на КАЖДЫЙ запрос. Держим результат в памяти
// 30 секунд: смена роли или отключение действуют не позже чем через полминуты (у самого сервера — сразу, см. invalidateActor).
const ACTOR_TTL_MS = 30_000;
const actorCache = new Map<string, { at: number; actor: Actor & { name: string } }>();

/** Сбросить кэш проверки (после смены роли/отключения пользователя). Без аргумента — для всех. */
export function invalidateActor(userId?: string): void {
  if (userId) actorCache.delete(userId);
  else actorCache.clear();
}

export async function requireActor(): Promise<Actor & { name: string }> {
  const session = await requireSession();
  const hit = actorCache.get(session.userId);
  if (hit && Date.now() - hit.at < ACTOR_TTL_MS) return hit.actor;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) {
    actorCache.delete(session.userId);
    throw new AuthError("UNAUTHENTICATED");
  }
  const actor = { id: user.id, name: user.name, role: user.role };
  actorCache.set(session.userId, { at: Date.now(), actor });
  return actor;
}

/**
 * Как requireSession, но роль берётся из базы (через requireActor, кэш 30 с), а не из токена входа.
 * Токен выдаётся при входе и не обновляется, поэтому для решений «кто что может» нужна эта функция:
 * тогда назначение куратором и снятие действуют сразу, без перевхода.
 */
export async function requireFreshSession(): Promise<{ userId: string; role: Actor["role"] }> {
  const actor = await requireActor();
  return { userId: actor.id, role: actor.role };
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
