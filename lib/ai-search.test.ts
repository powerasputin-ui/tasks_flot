import { describe, expect, it } from "vitest";
import { hitsAnswer, hitsBlock, isSearchQuestion, searchAll, searchTerms, stem, type SearchItem, type SearchMemo } from "@/lib/ai-search";
import { routeTask } from "@/lib/local-ai-prompt";
import { normalizeText } from "@/lib/search";

const item = (id: string, name: string, extra: Partial<SearchItem> = {}): SearchItem => {
  const base = { id, name, comment: null, trackName: null, segmentName: null, ownerName: null, statusName: null, deadline: null, archived: false, ...extra };
  return { ...base, haystack: normalizeText([base.name, base.comment, base.trackName, base.ownerName, base.statusName].filter(Boolean).join(" ")) + (base.archived ? " удалена" : "") };
};
const b = (id: string, text: string) => ({ id, text, itemIds: [], origin: "auto" as const, edited: false, hidden: false, sourceHash: "" });
const memo: SearchMemo = { id: "v1", directorate: "Флот", title: "Оперативка №40", date: "02.10.2026", doc: { sections: [{ id: "s", title: "Ремонт", kind: "section", bullets: [b("1", "Ремонт главного двигателя т/х «Капитан» завершён."), b("2", "Закуплено топливо.")] }] } };

describe("поиск для ИИ: слова вопроса", () => {
  it("служебные слова убираются, у длинных — основа, числа целиком", () => {
    expect(searchTerms("Найди, пожалуйста, где у нас ремонт двигателей т/х Капитан в 2026")).toEqual(["ремон", "двигател", "капит", "2026"]);
    expect(stem("двигателя")).toBe("двигате");
    expect(stem("ремонт")).toBe("ремон");
    expect(stem("насос")).toBe("насос");
  });
  it("поисковый вопрос отличается от разбора справки", () => {
    for (const q of ["Найди ремонт насоса", "Есть ли в таблице позиция про буксир?", "Кто отвечает за страхование?", "Что было в прошлых справках по Норду?", "Покажи удалённые по ДГ"]) {
      expect(isSearchQuestion(q)).toBe(true);
      expect(routeTask(q, "zgd").task).toBe("search");
    }
    for (const q of ["Найди слабые места справки", "Где мне стоит вмешаться, даже если не просили?", "Проверь справку: где формулировки слабые", "Какие вопросы задать директору?", "Выжимка: главное и на что обратить внимание", "Где просрочки?"]) expect(isSearchQuestion(q)).toBe(false);
    // вопрос про открытую справку — свободный (ответ по справке, находки поиска только в помощь)
    expect(routeTask("Когда была подготовлена справка и когда сделана презентация по приобретению судна?", "compiler").task).toBe("free");
  });
});

describe("поиск для ИИ: находки", () => {
  const items = [
    item("a", "Ремонт ГД т/х Капитан", { ownerName: "Иванов", statusName: "В работе", deadline: "2026-10-03" }),
    item("b", "Закупка топлива"),
    item("c", "Ремонт двигателя т/х Капитан (старая)", { archived: true }),
    item("d", "Страхование флота"),
  ];
  it("находит в таблице (и удалённые) и в справках, разные формы слов, по убыванию совпадений", () => {
    const { hits } = searchAll("найди ремонт двигателя Капитан", items, [memo]);
    const ids = hits.map((h) => (h.kind === "item" ? h.item.id : `memo:${h.text.slice(0, 6)}`));
    expect(ids).toContain("c"); // удалённая
    expect(ids).toContain("memo:Ремонт");
    expect(ids).not.toContain("b");
    expect(ids).not.toContain("d");
    expect(hits[0].kind === "item" ? hits[0].item.id : "memo").not.toBe("a"); // «a» без слова «двигатель» — ниже
  });
  it("ответ без модели и блок для модели: метки [Т]/[С], удалённые помечены", () => {
    const found = searchAll("ремонт двигателя Капитан", items, [memo]);
    const text = hitsAnswer(found, "таблица и справки");
    expect(text).toMatch(/\[Т\d\] УДАЛЕНА — позиция «Ремонт двигателя т\/х Капитан \(старая\)»/);
    expect(text).toMatch(/\[С1\] справка «Оперативка №40» от 02\.10\.2026 \(Флот\), раздел «Ремонт»/);
    const block = hitsBlock(found, 400, "таблица");
    expect(block.length).toBeLessThan(500);
    expect(block.startsWith("НАЙДЕНО ПОИСКОМ")).toBe(true);
  });
  it("ничего не нашлось / не понятно, что искать", () => {
    expect(hitsAnswer(searchAll("найди дирижабль", items, [memo]), "таблица")).toMatch(/Ничего не нашлось/);
    expect(hitsAnswer(searchAll("найди где", items, [memo]), "таблица")).toMatch(/Не понял, что искать/);
  });
});
