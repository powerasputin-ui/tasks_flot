import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { isConnectionError, poolConfig } from "@/lib/prisma";

describe("подключение к базе на засыпающем сервере", () => {
  it("пул получает пределы ожидания, а параметры движка Prisma убираются из адреса (pg их не знает)", () => {
    const c = poolConfig("postgresql://u:p@h/db?sslmode=require&pgbouncer=true&connect_timeout=30&socket_timeout=20");
    const u = new URL(c.connectionString!);
    expect(u.searchParams.get("sslmode")).toBe("verify-full"); // то же, что pg делает с require, но без предупреждения в журнале
    for (const k of ["pgbouncer", "connect_timeout", "socket_timeout"]) expect(u.searchParams.has(k)).toBe(false);
    expect(c).toMatchObject({ connectionTimeoutMillis: 15000, query_timeout: 25000, idleTimeoutMillis: 10000, keepAlive: true });
  });
  it("«мёртвое» соединение и тайм-ауты — повод повторить; ошибки данных — нет", () => {
    const known = (code: string, msg = "x") => new Prisma.PrismaClientKnownRequestError(msg, { code, clientVersion: "6" });
    for (const c of ["P1001", "P1008", "P1017", "P2024"]) expect(isConnectionError(known(c))).toBe(true);
    for (const c of ["P2002", "P2025", "P2003"]) expect(isConnectionError(known(c))).toBe(false);
    // ошибка данных с «connection» в тексте не повторяется; ошибка драйвера без кода данных — повторяется
    expect(isConnectionError(known("P2002", "Unique constraint on connection"))).toBe(false);
    expect(isConnectionError(known("P2010", "Connection terminated unexpectedly"))).toBe(true);
    expect(isConnectionError(new Prisma.PrismaClientUnknownRequestError("Server has closed the connection", { clientVersion: "6" }))).toBe(true);
    expect(isConnectionError(new Error("timeout"))).toBe(false);
  });
});
