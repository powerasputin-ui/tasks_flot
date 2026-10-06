import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolConfig } from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Подключение к базе через драйвер `pg` со своим пулом, а не встроенным движком Prisma.
 * Причина — зависания на проде (Vercel + Neon через пулер): Neon молча закрывает простаивающие соединения, а замороженный
 * между запросами экземпляр Vercel потом брал «мёртвое» соединение и ждал минуту. Здесь у каждого этапа свой предел:
 * - connectionTimeoutMillis 15 с — подключение (утром база просыпается за несколько секунд);
 * - query_timeout 25 с — один запрос к базе, после чего он падает и чтение повторяется на новом соединении (см. ниже);
 * - idleTimeoutMillis 10 с — простаивающие соединения закрываем сами раньше, чем это сделает Neon;
 * - keepAlive — оборванное соединение замечается сетью, а не через минуту;
 * - max 5 — экземпляров функций много, а у бесплатного Neon число соединений ограничено.
 * Параметры, понятные только движку Prisma (pgbouncer, connect_timeout и т.п.), из адреса убираем — `pg` их не знает.
 */
export function poolConfig(url: string | undefined): PoolConfig {
  let connectionString = url;
  if (url) {
    try {
      const u = new URL(url);
      for (const k of ["pgbouncer", "connect_timeout", "pool_timeout", "socket_timeout", "connection_limit", "statement_cache_size", "schema"]) u.searchParams.delete(k);
      // `pg` и так проверяет сертификат при sslmode=require и пишет об этом предупреждение в журнал на каждом запуске — называем режим прямо
      if (u.searchParams.get("sslmode") === "require") u.searchParams.set("sslmode", "verify-full");
      connectionString = u.toString();
    } catch {
      /* адрес не разобрался — отдаём как есть, `pg` сам сообщит об ошибке */
    }
  }
  return { connectionString, max: 5, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 10_000, query_timeout: 25_000, keepAlive: true };
}

/** Только чтение повторяем безопасно: повтор записи мог бы выполнить её дважды. */
const READS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);

/** Сообщения драйвера `pg` и Prisma о том, что соединение умерло или не дождались ответа. */
const CONNECTION_MESSAGE = /closed|reset|terminat|timed? ?out|socket|connection|ECONNRESET|ETIMEDOUT|EPIPE/i;

/** Ошибка «соединение умерло / не дождались», а не ошибка данных. */
export function isConnectionError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (["P1001", "P1002", "P1008", "P1017", "P2024"].includes(e.code)) return true;
    // ошибки драйвера приходят под общими кодами — смотрим на текст, но ошибки данных (уникальность, связи, «не найдено») не трогаем
    if (["P2002", "P2003", "P2025", "P2014", "P2034"].includes(e.code)) return false;
    return CONNECTION_MESSAGE.test(e.message);
  }
  if (e instanceof Prisma.PrismaClientInitializationError || e instanceof Prisma.PrismaClientUnknownRequestError) return CONNECTION_MESSAGE.test(e.message);
  return false;
}

/** Запросы к базе дольше этого пишутся в журнал Vercel (поиск причины зависаний). */
const SLOW_DB_MS = 2000;
let firstQuery = true;

function create(): PrismaClient {
  const pool = new Pool(poolConfig(process.env.DATABASE_URL));
  // ошибка простаивающего соединения (Neon его закрыл) не должна ронять процесс: пул просто откроет новое
  pool.on("error", (e) => console.warn(`[db-pool] ${e.message.slice(0, 160)}`));
  const base = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  // чтение, упавшее на «мёртвом» соединении, сразу повторяем: пул откроет новое соединение
  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const t = Date.now();
          try {
            return await query(args);
          } catch (e) {
            if (!READS.has(operation) || !isConnectionError(e)) throw e;
            console.warn(`[db-retry] ${model}.${operation} после ${Date.now() - t} мс: ${(e as Error).message.slice(0, 160)}`);
            return query(args);
          } finally {
            // диагностика зависаний на проде: какой запрос к базе был медленным и сколько ждал (первый — с подключением)
            const ms = Date.now() - t;
            if (ms > SLOW_DB_MS) console.warn(`[db-slow] ${model}.${operation} ${ms} мс${firstQuery ? " (первый запрос экземпляра — с подключением)" : ""}`);
            firstQuery = false;
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
