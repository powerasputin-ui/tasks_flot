import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { burstLimited, clientIp } from "@/lib/rate-limit";

const bootAt = Date.now();
let served = 0;

/**
 * «Будильник» и проверка связи: страница входа дёргает его при открытии, пока человек набирает пароль, чтобы сервер
 * и засыпающая база успели проснуться. Базу ждём не дольше 8 с и отвечаем в любом случае: висящий запрос корпоративный
 * прокси оборвёт, а так видно, на каком этапе задержка (dbMs, cold — первый запрос этого экземпляра сервера).
 */
export async function GET(request: NextRequest) {
  const flood = burstLimited(`health:${clientIp(request)}`, 20, 60_000);
  if (flood) return flood;
  const cold = served++ === 0;
  const t = Date.now();
  const db = await Promise.race([
    prisma.directorate.findFirst({ select: { id: true } }).then(() => "ok" as const, () => "error" as const),
    new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 8000)),
  ]);
  const body = { ok: db === "ok", db, dbMs: Date.now() - t, cold, uptimeMs: Date.now() - bootAt };
  return NextResponse.json(body, { status: db === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
