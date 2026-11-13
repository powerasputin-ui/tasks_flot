import { describe, expect, it } from "vitest";
import { allLabel, DEFAULT_TERMS, noneLabel, normalizeTerms, TERM_MAX, termsKey } from "@/lib/terms";

describe("названия разделов таблицы у дирекции", () => {
  it("ничего не настроено или запись испорчена — «Сегмент / Сегменты»", () => {
    for (const v of [null, undefined, "Проект", 5, {}, { one: "", many: "   " }]) expect(normalizeTerms(v)).toEqual(DEFAULT_TERMS);
  });
  it("свои названия: пробелы убраны, длина ограничена, пустое поле — по умолчанию", () => {
    expect(normalizeTerms({ one: "  Проект ", many: "Проекты" })).toEqual({ one: "Проект", many: "Проекты" });
    expect(normalizeTerms({ one: "", many: "Суда" })).toEqual({ one: "Сегмент", many: "Суда" });
    expect(normalizeTerms({ one: "я".repeat(100), many: "Суда" }).one).toHaveLength(TERM_MAX);
  });
  it("подписи: по умолчанию — как было; со своим названием — без угадывания падежа", () => {
    expect([allLabel(DEFAULT_TERMS), noneLabel(DEFAULT_TERMS)]).toEqual(["Все сегменты", "Без сегмента"]);
    const t = { one: "Проект", many: "Проекты" };
    expect([allLabel(t), noneLabel(t)]).toEqual(["Проекты: все", "Проект не указан"]);
  });
  it("у каждой дирекции свой ключ настройки", () => {
    expect(termsKey("a")).not.toBe(termsKey("b"));
  });
});
