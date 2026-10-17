import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";

/**
 * Журнал ошибок прода: сервер (необработанные исключения API) и браузер (ошибки страниц). Одинаковые ошибки склеиваются
 * по отпечатку — растут count и lastAt. Пишем только то, что нужно для поиска причины: маршрут без параметров, текст ошибки,
 * начало стека, роль. Тексты задач, тела запросов, e-mail и id пользователей не пишем (и вычищаем из текста, если попали).
 */
export type ErrorSource = "SERVER" | "CLIENT";
export const ERROR_KEEP_DAYS = 90;
const MAX_MESSAGE = 500;
const STACK_LINES = 8;

/** Маршрут без адреса сайта, параметров и якоря; id в пути заменены на «:id» (одна ошибка на разных задачах — одна запись). */
export function cleanRoute(route: string): string {
  let r = route;
  try {
    if (/^https?:\/\//.test(r)) r = new URL(r).pathname;
  } catch {
    /* оставляем как есть */
  }
  return r
    .split(/[?#]/)[0]
    .replace(/\/c[a-z0-9]{20,}(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:id")
    .slice(0, 200) || "/";
}

/** Текст ошибки без личных данных: e-mail, телефоны и длинные числа заменены. */
export function cleanText(text: string, max = MAX_MESSAGE): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/\+?\d[\d\s()-]{8,}\d/g, "<число>")
    .slice(0, max);
}

export function cleanStack(stack: string | null | undefined): string | null {
  if (!stack) return null;
  return cleanText(stack.split("\n").slice(0, STACK_LINES).join("\n"), 4000);
}

export function fingerprintOf(source: ErrorSource, route: string, message: string, stack: string | null): string {
  const firstFrame = (stack ?? "").split("\n").find((l) => /^\s*at /.test(l))?.trim() ?? "";
  // номера строк/столбцов в сборке меняются от выкладки к выкладке — в отпечаток не входят
  return createHash("sha1").update([source, route, message.replace(/\d+/g, "#"), firstFrame.replace(/:\d+:\d+\)?$/, "")].join("\n")).digest("hex");
}

/** Записать ошибку; сбой самой записи никогда не роняет вызывающего. */
export async function recordError(input: { source: ErrorSource; route: string; message: string; stack?: string | null; role?: string | null }): Promise<void> {
  try {
    const route = cleanRoute(input.route);
    const message = cleanText(input.message || "Ошибка без текста");
    const stack = cleanStack(input.stack);
    const fingerprint = fingerprintOf(input.source, route, message, stack);
    await prisma.appError.upsert({
      where: { fingerprint },
      create: { fingerprint, source: input.source, route, message, stack, role: input.role ?? null },
      update: { count: { increment: 1 }, lastAt: new Date(), ...(input.role ? { role: input.role } : {}) },
    });
  } catch (e) {
    console.error("error-log: не удалось записать ошибку", e);
  }
}

/** Ежедневно (cron): уведомить админов о новых за сутки ошибках и убрать записи старше срока хранения. */
export async function errorDigest(now = new Date()): Promise<{ fresh: number; pruned: number }> {
  const since = new Date(now.getTime() - 864e5);
  const fresh = await prisma.appError.count({ where: { firstAt: { gte: since } } });
  if (fresh > 0) {
    const admins = await prisma.user.findMany({ where: { isActive: true, role: { in: ["ADMIN", "SYSTEM_ADMIN"] } }, select: { id: true } });
    for (const a of admins) await createNotification({ userId: a.id, type: "CHANGE_ATTENTION", message: `За сутки новых ошибок на сайте: ${fresh}. Посмотрите журнал.`, link: "/settings?section=errors" });
  }
  const pruned = (await prisma.appError.deleteMany({ where: { lastAt: { lt: new Date(now.getTime() - ERROR_KEEP_DAYS * 864e5) } } })).count;
  return { fresh, pruned };
}
