import { describe, expect, it } from "vitest";
import { cleanRoute, cleanStack, cleanText, fingerprintOf } from "@/lib/error-log";

describe("журнал ошибок: очистка и склейка", () => {
  it("маршрут без адреса сайта, параметров и id", () => {
    expect(cleanRoute("https://tasks-flot.vercel.app/tracker?item=abc&q=секрет#x")).toBe("/tracker");
    expect(cleanRoute("/api/items/cmvaxfrkg00035qggy1mn7yx5/workflow")).toBe("/api/items/:id/workflow");
    expect(cleanRoute("")).toBe("/");
  });
  it("из текста убираются e-mail и длинные числа (телефоны)", () => {
    expect(cleanText("нет пользователя ivanov@gazprom.ru, тел. +7 (912) 345-67-89")).toBe("нет пользователя <email>, тел. <число>");
    expect(cleanText("x".repeat(900))).toHaveLength(500);
  });
  it("стек — только первые строки", () => {
    const stack = Array.from({ length: 20 }, (_, i) => `    at f${i} (file.js:${i}:1)`).join("\n");
    expect(cleanStack(stack)!.split("\n")).toHaveLength(8);
    expect(cleanStack(null)).toBeNull();
  });
  it("одна и та же ошибка в разных сборках и с разными числами склеивается; другая — нет", () => {
    const a = fingerprintOf("SERVER", "/api/x", "Не найдено 15 строк", "Error\n    at load (chunk.js:10:20)");
    const b = fingerprintOf("SERVER", "/api/x", "Не найдено 27 строк", "Error\n    at load (chunk.js:99:3)");
    const c = fingerprintOf("CLIENT", "/api/x", "Не найдено 15 строк", "Error\n    at load (chunk.js:10:20)");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
