import { describe, expect, it } from "vitest";
import type { MemoDoc } from "@/lib/memo";
import { analyzeMemos, buildLocalPrompt, localRewriteMessages, routeTask, type LocalMemo } from "@/lib/local-ai-prompt";
import { isLooping, looksRussian, unknownNumbers } from "@/lib/local-ai";

const TODAY = Date.UTC(2026, 9, 9); // 09.10.2026

const bullet = (id: string, text: string, itemIds: string[] = [], extra: object = {}) => ({ id, text, itemIds, origin: "auto" as const, edited: false, hidden: false, sourceHash: "", ...extra });
const doc: MemoDoc = {
  sections: [
    {
      id: "s1",
      title: "Ремонт судов",
      kind: "section",
      bullets: [
        bullet("b1", "Ведется работа по ремонту главного двигателя т/х «Капитан», направлено письмо на верфь.", ["i1"]),
        bullet("b2", "Подписан договор на поставку запчастей на 12,5 млн руб.", ["i2"]),
        bullet("b3", "Ремонт двигателя т/х «Капитан»: ведется работа, письмо на верфь направлено.", ["i3"], { fresh: true }),
      ],
    },
    { id: "s2", title: "Закупки", kind: "section", bullets: [bullet("b4", "Тендер на топливо.", []), bullet("b5", "Скрытый", [], { hidden: true })] },
  ],
};
const memo: LocalMemo = {
  directorate: "Флот",
  title: "Оперативка №3",
  doc,
  sources: [
    { id: "i1", ownerName: "Иванов И.", statusName: "В работе", deadline: "2026-10-01T00:00:00.000Z" },
    { id: "i2", ownerName: "Петров П.", statusName: "Завершено", deadline: "2026-09-01T00:00:00.000Z", attractivenessName: "Высокое" },
    { id: "i3", ownerName: null, statusName: "В работе", deadline: "2026-10-12T00:00:00.000Z" },
  ],
};

describe("локальная модель: разбор справки кодом", () => {
  const f = analyzeMemos([memo], TODAY);
  it("нумерует только видимые пункты по порядку", () => {
    expect(f.map((x) => x.n)).toEqual([1, 2, 3, 4]);
    expect(f.map((x) => x.section)).toEqual(["Ремонт судов", "Ремонт судов", "Ремонт судов", "Закупки"]);
  });
  it("сроки считает сам: просрочка, скоро, закрытые статусы не просрочены, нет срока", () => {
    expect(f[0].overdue).toEqual({ date: "01.10.2026", days: 8 });
    expect(f[1].overdue).toBeUndefined(); // «Завершено» — не просрочка
    expect(f[2].soon).toEqual({ date: "12.10.2026", days: 3 });
    expect(f[3].noDeadline).toBe(true);
  });
  it("пустые формулировки, зависимости, дубли, нет ответственного, новая подача", () => {
    expect(f[0].vague).toBe(true);
    expect(f[1].vague).toBe(false); // «подписан» — результат
    expect(f[0].depends).toMatch(/верф/);
    expect(f[3].depends).toMatch(/тендер/);
    expect(f[2].similarTo).toBe(1);
    expect(f[2].noOwner).toBe(true);
    expect(f[2].fresh).toBe(true);
    expect(f[1].attention).toBe("Высокое");
  });
});

describe("локальная модель: что спросили", () => {
  it("быстрые кнопки ЗГД попадают в свою задачу", () => {
    expect(routeTask("Выжимка: главное и на что обратить внимание", "zgd").task).toBe("summary");
    expect(routeTask("Найди слабые места справки", "zgd").task).toBe("risks");
    expect(routeTask("Где мне стоит вмешаться, даже если не просили?", "zgd").task).toBe("intervene");
    expect(routeTask("Сроки: что просрочено, без срока или под угрозой", "zgd").task).toBe("deadlines");
    expect(routeTask("Какие вопросы задать директору?", "zgd").task).toBe("questions");
  });
  it("быстрые кнопки Оперативщика и вопрос про конкретный пункт", () => {
    expect(routeTask("Проверь справку: где формулировки слабые", "compiler").task).toBe("weak");
    expect(routeTask("Приведи пункты к одному стилю", "compiler").task).toBe("style");
    expect(routeTask("Что в справке будет непонятно руководству?", "compiler").task).toBe("leaders");
    expect(routeTask("Перепиши пункт 3", "compiler")).toEqual({ task: "bullet", bullet: 3 });
    expect(routeTask("что с [2]?", "zgd")).toEqual({ task: "bullet", bullet: 2 });
    expect(routeTask("Сколько стоит ремонт?", "zgd").task).toBe("free");
  });
});

describe("локальная модель: запрос", () => {
  it("правила, разбор, все пункты с пометками; задача — в конце; по-русски", () => {
    const p = buildLocalPrompt({ audience: "zgd", memos: [memo], messages: [{ role: "user", content: "Сроки: что просрочено?" }], contextChars: 10000, historyChars: 3000, today: TODAY });
    expect(p.task).toBe("deadlines");
    expect(p.system).toContain("Отвечай только на русском языке");
    expect(p.system).toContain("Просрочен срок: [1].");
    expect(p.system).toContain("[1] Ведется работа");
    expect(p.system).toContain("срок 01.10.2026 — просрочен на 8 дн.");
    expect(p.system).not.toContain("Скрытый");
    const last = p.messages[p.messages.length - 1].content;
    expect(last.startsWith("Сроки: что просрочено?")).toBe(true);
    expect(last).toMatch(/Задача: Разбери сроки[\s\S]*Отвечай по-русски\.$/);
    expect(p.trimmed).toBe(false);
  });
  it("маленькое окно: пункты сокращаются, но разбор по всей справке остаётся; номера не сдвигаются", () => {
    const many: LocalMemo = { ...memo, doc: { sections: [{ id: "s", title: "Раздел", kind: "section", bullets: Array.from({ length: 60 }, (_, i) => bullet(`x${i}`, `Пункт номер ${i + 1}: подробное описание хода работ по направлению, без особых проблем и рисков.`, i === 41 ? ["i1"] : [])) }] } };
    const p = buildLocalPrompt({ audience: "zgd", memos: [many], messages: [{ role: "user", content: "Где просрочки?" }], contextChars: 3000, historyChars: 1500, today: TODAY });
    expect(p.system.length).toBeLessThan(3000 + 1500);
    expect(p.system).toContain("Просрочен срок: [42].");
    expect(p.system).toContain("[42] Пункт номер 42");
    expect(p.trimmed).not.toBe(false);
  });
  it("история — только последние обмены и с вопроса", () => {
    const msgs = Array.from({ length: 9 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `сообщение ${i}` }));
    const p = buildLocalPrompt({ audience: "compiler", memos: [memo], messages: msgs, contextChars: 10000, historyChars: 3000, today: TODAY });
    expect(p.messages.length).toBe(5);
    expect(p.messages[0]).toEqual({ role: "user", content: "сообщение 4" });
  });
  it("вопрос про пункт — его полный текст рядом с вопросом", () => {
    const p = buildLocalPrompt({ audience: "compiler", memos: [memo], messages: [{ role: "user", content: "Перепиши пункт 2" }], contextChars: 10000, historyChars: 3000, today: TODAY });
    expect(p.task).toBe("bullet");
    expect(p.messages[0].content).toContain("Пункт [2]: Подписан договор");
    const bad = buildLocalPrompt({ audience: "compiler", memos: [memo], messages: [{ role: "user", content: "Перепиши пункт 99" }], contextChars: 10000, historyChars: 3000, today: TODAY });
    expect(bad.task).toBe("free");
  });
  it("переписать пункт — пример и сам пункт", () => {
    const m = localRewriteMessages("Текст");
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(m[2].content).toMatch(/^Пункт: Текст/);
  });
});

describe("локальная модель: страховки ответа", () => {
  it("русский / не русский", () => {
    expect(looksRussian("В справке три пункта, срок по т/х MV Arctic просрочен.")).toBe(true);
    expect(looksRussian("The memo contains three items and one of them is overdue.")).toBe(false);
    expect(looksRussian("OK")).toBe(true);
  });
  it("зацикливание", () => {
    expect(isLooping("Отвечать на вопросы и вопросы. Отвечать на вопросы и вопросы. Отвечать на вопросы и вопросы.")).toBe(true);
    expect(isLooping("Первый пункт про ремонт. Второй пункт про закупки. Третий пункт про сроки.")).toBe(false);
  });
  it("числа не из справки", () => {
    const prompt = "[1] Договор на 12,5 млн руб., срок 01.10.2026";
    expect(unknownNumbers("1. [1] Договор на 12,5 млн — срок 01.10.2026.", prompt)).toEqual([]);
    expect(unknownNumbers("2. [1] Договор на 15 млн, срок 2027.", prompt)).toEqual(["15", "2027"]);
  });
});
