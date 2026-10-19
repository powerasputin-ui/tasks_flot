import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";

/**
 * Журнал ошибок прода: сервер (необработанные исключения API) и браузер (ошибки страниц). Одинаковые ошибки склеиваются
 * по отпечатку — растут count и lastAt. Пишем только то, что нужно для поиска причины: маршрут без параметров, первую строку
 * текста ошибки, кадры стека (без текста), роль. Тексты задач, тела запросов, e-mail и id пользователей не пишем.
 * Важно: ошибки Prisma несут в тексте и в стеке аргументы запроса (название задачи, комментарий) — от них берём только код и модель.
 */
export type ErrorSource = "SERVER" | "CLIENT";
export const ERROR_KEEP_DAYS = 90;
/** Сколько разных ошибок храним: защита от засорения журнала (сверх этого новые ошибки браузера не пишутся). */
export const ERROR_MAX_ROWS = 2000;
const MAX_MESSAGE = 300;
const STACK_FRAMES = 8;

/** Маршрут без адреса сайта, параметров и якоря; id в пути заменены на «:id» (одна ошибка на разных задачах — одна запись). */
export function cleanRoute(route: string): string {
  let r = route;
  try {
    if (/^https?:\/\//.test(r)) r = new URL(r).pathname;
  } catch {
    /* оставляем как есть */
  }
  return (
    r
      .split(/[?#]/)[0]
      .replace(/\/c[a-z0-9]{20,}(?=\/|$)/g, "/:id")
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:id")
      .slice(0, 200) || "/"
  );
}

/** Строка без личных данных: e-mail, телефоны, длинные ряды цифр (номера карт, счетов). Даты и короткие числа не трогаем. */
export function cleanText(text: string, max = MAX_MESSAGE): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/(?:\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g, "<телефон>")
    .replace(/\d{10,}/g, "<число>")
    .slice(0, max);
}

/** Только первая непустая строка текста ошибки: дальше у многих ошибок идут данные (аргументы, тело ответа). */
export function firstLine(text: string): string {
  return text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

/** Только кадры стека («at …»): первая строка стека — это текст ошибки, его здесь не храним. */
export function cleanStack(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const frames = stack.split("\n").filter((l) => /^\s*at /.test(l)).slice(0, STACK_FRAMES);
  return frames.length ? cleanText(frames.join("\n"), 4000) : null;
}

/** Текст для журнала: у ошибок Prisma — только класс, код и модель (их текст содержит аргументы запроса), у остальных — первая строка. */
export function describeError(e: unknown): string {
  const err = e instanceof Error ? e : new Error(String(e));
  if (/^PrismaClient/.test(err.name)) {
    const code = (err as { code?: string }).code;
    const model = (err as { meta?: { modelName?: string } }).meta?.modelName ?? /prisma\.(\w+)\.\w+\(\)/.exec(err.message)?.[1];
    return [err.name, code, model].filter(Boolean).join(" ");
  }
  return firstLine(err.message) || err.name || "Ошибка без текста";
}

/** Ошибки управления потоком Next (redirect, notFound, динамический рендеринг): это не поломки, в журнал не пишем. */
export function isFrameworkSignal(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && /^(NEXT_|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(digest);
}

export function fingerprintOf(source: ErrorSource, route: string, message: string, stack: string | null): string {
  // у ошибок браузера кадры — из сжатых файлов сборки (имена меняются от выкладки к выкладке): склеиваем по маршруту и тексту;
  // у сервера — плюс первый кадр без номеров строк
  const frame = source === "SERVER" ? ((stack ?? "").split("\n")[0] ?? "").trim().replace(/:\d+:\d+\)?$/, "") : "";
  return createHash("sha1").update([source, route, message.replace(/\d+/g, "#"), frame].join("\n")).digest("hex");
}

/** Записать ошибку; сбой самой записи никогда не роняет вызывающего. */
export async function recordError(input: { source: ErrorSource; route: string; message: string; stack?: string | null; role?: string | null }): Promise<void> {
  try {
    const route = cleanRoute(input.route);
    const message = cleanText(firstLine(input.message) || "Ошибка без текста");
    const stack = cleanStack(input.stack);
    const fingerprint = fingerprintOf(input.source, route, message, stack);
    const updated = await prisma.appError.updateMany({ where: { fingerprint }, data: { count: { increment: 1 }, lastAt: new Date(), ...(input.role ? { role: input.role } : {}) } });
    if (updated.count) return;
    // новая ошибка: журнал ограничен по числу записей — ошибки браузера сверх предела не пишем (сервер пишем всегда)
    if (input.source === "CLIENT" && (await prisma.appError.count()) >= ERROR_MAX_ROWS) return;
    await prisma.appError.create({ data: { fingerprint, source: input.source, route, message, stack, role: input.role ?? null } }).catch(async () => {
      // одновременно пришла такая же — склеиваем
      await prisma.appError.updateMany({ where: { fingerprint }, data: { count: { increment: 1 }, lastAt: new Date() } });
    });
  } catch (e) {
    console.error("error-log: не удалось записать ошибку", e);
  }
}

/** Запись с ограничением по времени: если база сама недоступна (частая причина ошибок), ответ не ждёт ещё одну попытку. */
export async function recordErrorQuickly(input: Parameters<typeof recordError>[0], ms = 1500): Promise<void> {
  await Promise.race([recordError(input), new Promise<void>((r) => setTimeout(r, ms))]);
}

/**
 * Ежедневно (cron): уведомить админов, если за сутки были ошибки — новые и повторившиеся старые (нерешённая ошибка,
 * которая продолжает случаться, важнее новой); убрать записи старше срока хранения.
 */
export async function errorDigest(now = new Date()): Promise<{ fresh: number; recurring: number; pruned: number }> {
  const since = new Date(now.getTime() - 864e5);
  const [fresh, recurring] = await Promise.all([prisma.appError.count({ where: { firstAt: { gte: since } } }), prisma.appError.count({ where: { firstAt: { lt: since }, lastAt: { gte: since } } })]);
  if (fresh + recurring > 0) {
    // техадмину, а если его нет — админам (в небольшой организации журнал смотрит админ)
    const tech = await prisma.user.findMany({ where: { isActive: true, role: "SYSTEM_ADMIN" }, select: { id: true } });
    const to = tech.length ? tech : await prisma.user.findMany({ where: { isActive: true, role: "ADMIN" }, select: { id: true } });
    const parts = [fresh ? `новых: ${fresh}` : "", recurring ? `повторялись: ${recurring}` : ""].filter(Boolean).join(", ");
    for (const a of to) await createNotification({ userId: a.id, type: "CHANGE_ATTENTION", message: `Ошибки на сайте за сутки — ${parts}. Посмотрите журнал.`, link: "/settings?section=errors" });
  }
  const pruned = (await prisma.appError.deleteMany({ where: { lastAt: { lt: new Date(now.getTime() - ERROR_KEEP_DAYS * 864e5) } } })).count;
  return { fresh, recurring, pruned };
}
