import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendMissingReminders } from "@/lib/cycles";
import { sendDeadlineReminders } from "@/lib/deadline-reminders";
import { isDigestWindowMsk, sendWeeklyDigests } from "@/lib/weekly-digest";
import { pruneNotifications } from "@/lib/notifications";
import { pruneChat } from "@/lib/chat-server";
import { errorDigest } from "@/lib/error-log";

// сводки обходят все дирекции — с запасом по времени (по умолчанию функция обрывается раньше)
export const maxDuration = 60;

/**
 * Ежедневный запуск Vercel Cron (09:00 МСК): напоминания «не подал» за 2 дня до срока оперативки и напоминания по срокам позиций;
 * по понедельникам — сводка за неделю ЗГД (его поручения и контроль) и директорам (что ждёт решения).
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
  // сбой сводки не должен ронять весь запуск: напоминания выше уже разосланы
  let weekly: unknown = null;
  if (isDigestWindowMsk(new Date())) {
    try {
      weekly = await sendWeeklyDigests();
    } catch (e) {
      console.error("weekly digest failed", e);
      weekly = { error: true };
    }
  }
  // уборка старых уведомлений — последней и без права ронять запуск
  let pruned = 0;
  try {
    pruned = await pruneNotifications();
  } catch (e) {
    console.error("notifications prune failed", e);
  }
  let chatPruned: unknown = null;
  try {
    chatPruned = await pruneChat();
  } catch (e) {
    console.error("chat prune failed", e);
  }
  // журнал ошибок сайта: сводка админам о новых за сутки и уборка старых записей
  let errors: unknown = null;
  try {
    errors = await errorDigest();
  } catch (e) {
    console.error("error digest failed", e);
  }
  return NextResponse.json({ cycles: cycles.length, people, deadlines, weekly, pruned, chatPruned, errors });
}
