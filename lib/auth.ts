import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 дней

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  userId: string;
  role: UserRole;
  email: string;
  /** Когда токен выдан (секунды) — для отзыва сессий. */
  iat?: number;
};

/** Хэш-пустышка: для несуществующего логина пароль всё равно сверяется, чтобы время ответа не выдавало, есть ли такой пользователь. */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.userId !== "string" || typeof payload.role !== "string" || typeof payload.email !== "string") {
      return null;
    }
    return { userId: payload.userId, role: payload.role as UserRole, email: payload.email, iat: typeof payload.iat === "number" ? payload.iat : undefined };
  } catch {
    return null;
  }
}

/** Токен, выданный до отзыва сессий (смена пароля, отключение, смена роли), недействителен, даже если подпись верна. */
export function isRevoked(session: { iat?: number }, validAfter: Date | null | undefined): boolean {
  if (!validAfter) return false;
  if (session.iat === undefined) return true; // токен без времени выдачи после отзыва не принимаем
  return session.iat < Math.floor(validAfter.getTime() / 1000);
}

export { SESSION_COOKIE, SESSION_TTL_SECONDS };
