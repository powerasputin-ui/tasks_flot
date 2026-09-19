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
export async function requireActor(): Promise<Actor & { name: string }> {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) throw new AuthError("UNAUTHENTICATED");
  return { id: user.id, name: user.name, role: user.role };
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
