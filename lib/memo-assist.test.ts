import { describe, expect, it } from "vitest";
import { cleanVariant, memoAssistContext, memoAssistSystem, newNumbers, rewriteSystem } from "@/lib/memo-assist";

describe("Оперативщик: правила для модели", () => {
  it("переписать пункт: стиль и запрет выдумывать факты", () => {
    const s = rewriteSystem("shorter");
    expect(s).toContain("короче");
    expect(s).toContain("Не добавляй фактов");
    expect(s).toContain("дословно");
    expect(rewriteSystem("formal")).toContain("официально-деловом");
  });

  it("чат видит пункты черновика с номерами, скрытые и пустые — нет", () => {
    const doc = {
      sections: [
        { id: "s1", title: "Tidebon", kind: "section" as const, bullets: [
          { id: "b1", text: "Презентация вынесена на руководство", itemIds: [], origin: "auto" as const, edited: false, hidden: false, sourceHash: "" },
          { id: "b2", text: "скрытый", itemIds: [], origin: "auto" as const, edited: false, hidden: true, sourceHash: "" },
          { id: "b3", text: "  ", itemIds: [], origin: "auto" as const, edited: false, hidden: false, sourceHash: "" },
        ] },
        { id: "other", title: "", kind: "other" as const, bullets: [{ id: "b4", text: "Договор подписан", itemIds: [], origin: "manual" as const, edited: false, hidden: false, sourceHash: "" }] },
      ],
    };
    const ctx = memoAssistContext(doc, "Справка");
    expect(ctx.count).toBe(2);
    expect(ctx.text).toContain("[1] Презентация вынесена на руководство");
    expect(ctx.text).toContain("[2] Договор подписан");
    expect(ctx.text).not.toContain("скрытый");
    expect(memoAssistSystem(ctx.text)).toContain("Оперативщик");
    // дата справки стоит в документе отдельно от заголовка — модель должна её видеть
    const dated = memoAssistContext(doc, "Справка", { number: 41, meetingDate: "2026-10-07T00:00:00.000Z" });
    expect(dated.text).toContain("Оперативка №41");
    expect(dated.text).toContain("Дата справки (оперативного совещания): 07.10.2026");
    expect(memoAssistSystem(dated.text)).toContain("не переспрашивай");
  });
});

describe("проверка ответа", () => {
  it("newNumbers: новые числа и даты в варианте", () => {
    expect(newNumbers("Срок 06.10.26, судно 801 / 803", "Судно 801/803, срок 06.10.26")).toEqual([]);
    expect(newNumbers("Подготовлена презентация", "Подготовлена презентация к 15.11.2026 на 2 млн")).toEqual(["15.11.2026", "2"]);
    expect(newNumbers("сумма 2,5 млн", "сумма 2.5 млн")).toEqual([]);
  });
  it("cleanVariant убирает кавычки и «Вариант:»", () => {
    expect(cleanVariant(" «Вариант: Договор подписан.» ".replace("«Вариант: ", "Вариант: «"))).toBe("Договор подписан.");
    expect(cleanVariant("\"Текст\"")).toBe("Текст");
  });
});
