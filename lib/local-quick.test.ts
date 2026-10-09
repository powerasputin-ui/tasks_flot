import { describe, expect, it } from "vitest";
import type { MemoDoc } from "@/lib/memo";
import { quickAnswer } from "@/lib/local-quick";
import type { LocalMemo } from "@/lib/local-ai-prompt";
import { ctxForSize } from "@/lib/local-ai";
import { localBudget } from "@/lib/ai";

const TODAY = Date.UTC(2026, 9, 9);
const b = (id: string, text: string, itemIds: string[] = []) => ({ id, text, itemIds, origin: "auto" as const, edited: false, hidden: false, sourceHash: "" });
const doc: MemoDoc = {
  sections: [
    {
      id: "s",
      title: "Ремонт",
      kind: "section",
      bullets: [
        b("1", "Ведется работа по ремонту ГД т/х «Капитан», направлено письмо на верфь.", ["i1"]),
        b("2", "Подписан договор поставки запчастей.", ["i2"]),
        b("3", "Ремонт системы ГМССБ — прорабатывается.", ["i3"]),
      ],
    },
  ],
};
const memo: LocalMemo = {
  directorate: "Флот",
  title: "Оперативка",
  doc,
  sources: [
    { id: "i1", ownerName: "Иванов И.", statusName: "В работе", deadline: "2026-09-25" },
    { id: "i2", ownerName: "Петров П.", statusName: "Завершено", deadline: "2026-09-01" },
    { id: "i3", ownerName: null, statusName: "В работе", deadline: null },
  ],
};
const ask = (question: string, audience: "zgd" | "compiler" = "zgd") => quickAnswer({ audience, memos: [memo], question, today: TODAY });

describe("мгновенный разбор без модели (процессор)", () => {
  it("сроки: просрочка с датой и днями, без срока; закрытые не просрочены", () => {
    const t = ask("Сроки: что просрочено, без срока или под угрозой")!;
    expect(t).toMatch(/Просрочено:\n1\. \[1\].*срок 25\.09\.2026, просрочен на 14 дн\. \(отв\. Иванов И\.\)/);
    expect(t).toMatch(/Без срока:\n1\. \[3\]/);
    expect(t).not.toMatch(/\[2\]/);
  });
  it("слабые места — сначала самое серьёзное, с тем, что уточнить", () => {
    const t = ask("Найди слабые места справки")!;
    expect(t.indexOf("[1]")).toBeLessThan(t.indexOf("[3]"));
    expect(t).toContain("зависит от внешнего: «верфь»");
    expect(t).toContain("Уточнить: причину сдвига и новый срок");
  });
  it("вопросы директору и где вмешаться", () => {
    expect(ask("Какие вопросы задать директору?")).toMatch(/\[1\] Почему сорван срок 25\.09\.2026/);
    expect(ask("Где мне стоит вмешаться, даже если не просили?")).toMatch(/\[1\].*поторопить «верфь»/);
  });
  it("выжимка: сделано и на что обратить внимание", () => {
    const t = ask("Выжимка: главное и на что обратить внимание")!;
    expect(t).toMatch(/Сделано:\n1\. \[2\]/);
    expect(t).toMatch(/На что обратить внимание:\n1\. \[1\]/);
  });
  it("составителю: формулировки и непонятные руководству сокращения (кириллица)", () => {
    expect(ask("Проверь справку: где формулировки слабые", "compiler")).toMatch(/\[3\].*пустая формулировка/);
    const t = ask("Что в справке будет непонятно руководству?", "compiler")!;
    expect(t).toContain("сокращения без расшифровки: ГМССБ");
    expect(t).not.toMatch(/расшифровки: [^.]*\bОС\b/); // известные (ГД, ЗГД, ОС, ТЗ) не помечаем
  });
  it("свободный вопрос и вопрос про пункт — модели, не разбору", () => {
    expect(ask("Сколько стоит ремонт двигателя?")).toBeNull();
    expect(ask("Перепиши пункт 2", "compiler")).toBeNull();
    expect(ask("Приведи пункты к одному стилю", "compiler")).toBeNull();
  });
});

describe("окно модели под её размер", () => {
  it("крупная модель — окно меньше, и сервер ужимает справку так же", () => {
    expect(ctxForSize(1.1e9)).toBe(8192);
    expect(ctxForSize(2.5e9)).toBe(6144);
    expect(ctxForSize(2.9e9)).toBe(4096);
    expect(localBudget("gpu", 8192).contextChars).toBeGreaterThan(localBudget("gpu", 6144).contextChars);
    expect(localBudget("gpu", 6144).contextChars).toBeGreaterThan(localBudget("gpu", 4096).contextChars);
    expect(localBudget("cpu", 8192).contextChars).toBe(1500);
  });
});
