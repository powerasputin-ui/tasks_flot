import { describe, expect, it } from "vitest";
import { cleanRoute, cleanStack, cleanText, describeError, fingerprintOf, firstLine, isFrameworkSignal } from "@/lib/error-log";

describe("журнал ошибок: очистка и склейка", () => {
  it("маршрут без адреса сайта, параметров и id", () => {
    expect(cleanRoute("https://tasks-flot.vercel.app/tracker?item=abc&q=секрет#x")).toBe("/tracker");
    expect(cleanRoute("/api/items/cmvaxfrkg00035qggy1mn7yx5/workflow")).toBe("/api/items/:id/workflow");
    expect(cleanRoute("GET /api/items/cmvaxfrkg00035qggy1mn7yx5")).toBe("GET /api/items/:id");
    expect(cleanRoute("")).toBe("/");
  });

  it("из текста убираются e-mail, телефоны и длинные ряды цифр; даты и короткие числа остаются", () => {
    expect(cleanText("нет пользователя ivanov@gazprom.ru, тел. +7 (912) 345-67-89")).toBe("нет пользователя <email>, тел. <телефон>");
    expect(cleanText("карта 4276123412341234")).toBe("карта <число>");
    expect(cleanText("срок 2026-10-19, таймаут 30000 мс")).toBe("срок 2026-10-19, таймаут 30000 мс");
    expect(cleanText("x".repeat(900))).toHaveLength(300);
  });

  it("первая строка текста; в стеке — только кадры (первая строка стека — это текст ошибки с данными)", () => {
    expect(firstLine("\n  Invalid `prisma.x.create()` invocation\n{ title: \"СЕКРЕТ\" }")).toBe("Invalid `prisma.x.create()` invocation");
    const stack = ["PrismaClientValidationError: Invalid invocation", '  data: { title: "СЕКРЕТНАЯ задача" }', ...Array.from({ length: 20 }, (_, i) => `    at f${i} (file.js:${i}:1)`)].join("\n");
    const clean = cleanStack(stack)!;
    expect(clean.split("\n")).toHaveLength(8);
    expect(clean).not.toContain("СЕКРЕТНАЯ");
    expect(cleanStack(null)).toBeNull();
  });

  it("ошибка Prisma описывается классом, кодом и моделью — без аргументов запроса", () => {
    const e = Object.assign(new Error("Invalid `prisma.operationalItem.create()` invocation:\n{ data: { title: \"СЕКРЕТНАЯ задача\" } }"), { name: "PrismaClientKnownRequestError", code: "P2002", meta: { modelName: "OperationalItem" } });
    expect(describeError(e)).toBe("PrismaClientKnownRequestError P2002 OperationalItem");
    const v = Object.assign(new Error("\nInvalid `prisma.operationalItem.create()` invocation in\n…title: \"СЕКРЕТ\""), { name: "PrismaClientValidationError" });
    expect(describeError(v)).toBe("PrismaClientValidationError operationalItem");
    expect(describeError(new Error("Обычная ошибка\nс подробностями"))).toBe("Обычная ошибка");
  });

  it("сигналы Next (redirect, notFound) — не ошибки", () => {
    expect(isFrameworkSignal(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }))).toBe(true);
    expect(isFrameworkSignal(Object.assign(new Error("x"), { digest: "DYNAMIC_SERVER_USAGE" }))).toBe(true);
    expect(isFrameworkSignal(new Error("обычная"))).toBe(false);
  });

  it("сервер: одна и та же ошибка в разных сборках и с разными числами склеивается, другой кадр — нет; браузер — по маршруту и тексту", () => {
    const a = fingerprintOf("SERVER", "/api/x", "Не найдено 15 строк", "    at load (chunk.js:10:20)");
    const b = fingerprintOf("SERVER", "/api/x", "Не найдено 27 строк", "    at load (chunk.js:99:3)");
    const c = fingerprintOf("SERVER", "/api/x", "Не найдено 15 строк", "    at other (x.js:1:1)");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(fingerprintOf("CLIENT", "/t", "ошибка", "    at a (1.js:1:1)")).toBe(fingerprintOf("CLIENT", "/t", "ошибка", "    at b (2.js:9:9)"));
  });
});
