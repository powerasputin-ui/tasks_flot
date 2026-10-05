import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Параметры подключения к базе для серверов, которые «засыпают» (Vercel + бесплатный Neon):
 * - connect_timeout / pool_timeout 30 с: утром база просыпается дольше стандартных 10 с;
 * - socket_timeout 20 с: Neon при засыпании молча закрывает соединение, и запрос по «мёртвому» соединению висел бы
 *   минуту и больше (корпоративный прокси обрывает раньше — «сайт не работает»). С ограничением запрос падает быстро
 *   и повторяется на новом соединении (см. retryReads ниже).
 * Явно заданные в адресе значения не трогаем.
 */
export function withWakeTimeouts(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", "30");
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "30");
    if (!u.searchParams.has("socket_timeout")) u.searchParams.set("socket_timeout", "20");
    return u.toString();
  } catch {
    return url;
  }
}

/** Только чтение повторяем безопасно: повтор записи мог бы выполнить её дважды. */
const READS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);

/** Ошибка «соединение умерло / не дождались», а не ошибка данных. */
export function isConnectionError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(e.code);
  if (e instanceof Prisma.PrismaClientInitializationError || e instanceof Prisma.PrismaClientUnknownRequestError) {
    return /closed|reset|terminat|timed? ?out|socket|connection/i.test(e.message);
  }
  return false;
}

const url = withWakeTimeouts(process.env.DATABASE_URL);

function create(): PrismaClient {
  const base = new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  // чтение, упавшее на «мёртвом» соединении, сразу повторяем: пул откроет новое соединение
  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          try {
            return await query(args);
          } catch (e) {
            if (!READS.has(operation) || !isConnectionError(e)) throw e;
            return query(args);
          }
        },
      },
    },
  });
  // тип оставляем обычным PrismaClient: расширение только добавляет повтор и не меняет API
  return extended as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? create();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
