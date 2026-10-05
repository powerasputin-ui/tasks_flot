import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { isConnectionError, withWakeTimeouts } from "@/lib/prisma";

describe("подключение к базе на засыпающем сервере", () => {
  it("адрес получает ограничения ожидания, в т.ч. socket_timeout; заданные вручную не трогаются", () => {
    const u = new URL(withWakeTimeouts("postgresql://u:p@h/db?sslmode=require")!);
    expect(u.searchParams.get("socket_timeout")).toBe("20");
    expect(u.searchParams.get("connect_timeout")).toBe("30");
    expect(new URL(withWakeTimeouts("postgresql://u:p@h/db?socket_timeout=5")!).searchParams.get("socket_timeout")).toBe("5");
  });
  it("«мёртвое» соединение и тайм-ауты — повод повторить; ошибки данных — нет", () => {
    const known = (code: string) => new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "6" });
    for (const c of ["P1001", "P1008", "P1017", "P2024"]) expect(isConnectionError(known(c))).toBe(true);
    for (const c of ["P2002", "P2025", "P2003"]) expect(isConnectionError(known(c))).toBe(false);
    expect(isConnectionError(new Prisma.PrismaClientUnknownRequestError("Server has closed the connection", { clientVersion: "6" }))).toBe(true);
    expect(isConnectionError(new Error("timeout"))).toBe(false);
  });
});
