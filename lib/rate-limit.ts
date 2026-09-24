import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Ограничение частоты запросов: окно фиксированной длины на ключ, счётчик в базе одним атомарным запросом
 * (приложение может работать в нескольких экземплярах — память процесса для этого не годится).
 */
export async function hitRateLimit(key: string, limit: number, windowMs: number): Promise<{ ok: boolean; count: number; retryAfterSec: number }> {
  const rows = await prisma.$queryRaw<Array<{ count: number; ageMs: number }>>`
    INSERT INTO "rate_limits" ("key", "windowStart", "count") VALUES (${key}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "windowStart" = CASE WHEN "rate_limits"."windowStart" < now() - (${windowMs} * interval '1 millisecond') THEN now() ELSE "rate_limits"."windowStart" END,
      "count" = CASE WHEN "rate_limits"."windowStart" < now() - (${windowMs} * interval '1 millisecond') THEN 1 ELSE "rate_limits"."count" + 1 END
    RETURNING "count", (extract(epoch from (now() - "windowStart")) * 1000)::float8 AS "ageMs"`;
  const { count, ageMs } = rows[0];
  // изредка чистим давно неиспользуемые ключи
  if (Math.random() < 0.01) void prisma.$executeRaw`DELETE FROM "rate_limits" WHERE "windowStart" < now() - interval '1 day'`.catch(() => {});
  return { ok: count <= limit, count, retryAfterSec: Math.max(1, Math.ceil((windowMs - ageMs) / 1000)) };
}

/** 429 с понятным текстом и Retry-After — или null, если запрос укладывается в лимит. */
export async function enforceRateLimit(key: string, limit: number, windowMs: number, what = "запросов"): Promise<NextResponse | null> {
  const r = await hitRateLimit(key, limit, windowMs);
  if (r.ok) return null;
  return NextResponse.json(
    { error: "RATE_LIMITED", message: `Слишком много ${what}. Попробуйте через ${r.retryAfterSec < 90 ? `${r.retryAfterSec} с` : `${Math.ceil(r.retryAfterSec / 60)} мин`}.` },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } }
  );
}

/** Адрес клиента за прокси (первый в X-Forwarded-For); без прокси — общий ключ «local». */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || request.headers.get("x-real-ip") || "local").slice(0, 64);
}
