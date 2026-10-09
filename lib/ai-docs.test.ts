import { describe, expect, it } from "vitest";
import type { MemoDoc } from "@/lib/memo";
import { collectDocs, docHref, docMarks, docRefs, docsAnswer, docsBlock, isDocsQuestion } from "@/lib/ai-docs";
import { memoAssistContext, memoAssistSystem } from "@/lib/memo-assist";
import { buildLocalPrompt } from "@/lib/local-ai-prompt";

const b = (id: string, text: string, itemIds: string[], hidden = false) => ({ id, text, itemIds, origin: "auto" as const, edited: false, hidden, sourceHash: "" });
const doc: MemoDoc = {
  sections: [
    { id: "s", title: "Tidebon 801 / 803", kind: "section", bullets: [b("1", "Подготовлена презентация по приобретению судна. 06.10.26 вынесена на руководство", ["i1"]), b("2", "Без документов", ["i2"]), b("3", "Скрытый", ["i3"], true)] },
  ],
};
const files = new Map([
  ["i1", { title: "Приобретение Tidebon", files: [{ id: "f1", name: "MPSV Tidebon v1.3.pptx", path: "\\\\10.10.51.51\\флот\\07 ОФФШОРНЫЙ ФЛОТ\\MPSV Tidebon v1.3.pptx" }] }],
  ["i3", { title: "Скрытая", files: [{ id: "f9", name: "секрет.docx", path: "D:\\секрет.docx" }] }],
]);

describe("документы пунктов для ИИ", () => {
  const docs = collectDocs([doc], files);
  it("собираются по видимым пунктам, с метками [Д1]…", () => {
    expect(docs).toEqual([{ n: 1, itemId: "i1", fileId: "f1", name: "MPSV Tidebon v1.3.pptx", path: "\\\\10.10.51.51\\флот\\07 ОФФШОРНЫЙ ФЛОТ\\MPSV Tidebon v1.3.pptx", itemTitle: "Приобретение Tidebon" }]);
    expect(docMarks(["i1"], docs)).toBe("документы: [Д1] «MPSV Tidebon v1.3.pptx»");
    expect(docMarks(["i2"], docs)).toBe("");
  });
  it("блок с путём и правило в подсказке Оперативщика; пометка у пункта", () => {
    const ctx = memoAssistContext(doc, "Справка", {}, docs);
    expect(ctx.text).toContain("[1] Подготовлена презентация по приобретению судна. 06.10.26 вынесена на руководство {документы: [Д1] «MPSV Tidebon v1.3.pptx»}");
    const block = docsBlock(docs);
    expect(block).toContain("[Д1] «MPSV Tidebon v1.3.pptx» — путь: \\\\10.10.51.51\\флот\\07 ОФФШОРНЫЙ ФЛОТ\\MPSV Tidebon v1.3.pptx");
    const sys = memoAssistSystem(`${ctx.text}\n\n${block}`);
    expect(sys).toContain("Содержимое файлов тебе не видно");
    expect(memoAssistSystem(ctx.text)).not.toContain("Содержимое файлов тебе не видно"); // без документов — без правила
  });
  it("локальная модель получает те же метки и блок", () => {
    const p = buildLocalPrompt({ audience: "compiler", memos: [{ directorate: "", title: "Справка", doc, sources: [{ id: "i1", ownerName: "Майков", statusName: "В работе", deadline: null }] }], messages: [{ role: "user", content: "Где лежит презентация?" }], contextChars: 8000, historyChars: 2000, docs });
    expect(p.system).toContain("документы: [Д1] «MPSV Tidebon v1.3.pptx»");
    expect(p.system).toContain("ДОКУМЕНТЫ, прикреплённые");
  });
  it("вопрос про документы — мгновенный список; ссылка на ярлык как у скрепки", () => {
    expect(isDocsQuestion("Где лежит презентация по Tidebon?")).toBe(true);
    expect(isDocsQuestion("Что просрочено?")).toBe(false);
    expect(docsAnswer("где презентация tidebon", docs)).toMatch(/\[Д1\] «MPSV Tidebon v1\.3\.pptx» — позиция «Приобретение Tidebon»\n {3}путь: /);
    expect(docsAnswer("что приложено", [])).toMatch(/не прикреплены/);
    expect(docHref(docRefs(docs)[0])).toBe("/api/items/i1/files/f1/shortcut");
  });
});
