import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendMissingReminders } from "@/lib/cycles";
import { sendDeadlineReminders } from "@/lib/deadline-reminders";

/**
 * Ежедневный запуск Vercel Cron (09:00 МСК): напоминания «не подал» за 2 дня до срока оперативки и напоминания по срокам позиций.
 * Vercel передаёт `Authorization: Bearer <CRON_SECRET>`; без заданного CRON_SECRET маршрут закрыт.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const cycles = await prisma.cycle.findMany({ where: { status: { not: "FINAL" }, remindersSentAt: null } });
  let people = 0;
  for (const c of cycles) people += await sendMissingReminders(c);
  // сроки позиций: «через 2 дня» и «просрочено» ответственным, сводка просрочек директору и админу
  const deadlines = await sendDeadlineReminders();
  return NextResponse.json({ cycles: cycles.length, people, deadlines });
}
