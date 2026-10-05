import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { burstLimited, clientIp } from "@/lib/rate-limit";

/**
 * Проверка связи и «будильник»: страница входа дёргает его при открытии, пока человек набирает пароль,
 * чтобы сервер и засыпающая база Neon успели проснуться. Ничего не возвращает, кроме ok — данных не раскрывает.
 */
export async function GET(request: NextRequest) {
  const flood = burstLimited(`health:${clientIp(request)}`, 20, 60_000);
  if (flood) return flood;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
