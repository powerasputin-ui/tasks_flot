import type { MemoDoc } from "@/lib/memo";

/** Общие с браузером типы и чистые функции ИИ-сводки (без серверных модулей). */
export type ConsolidatedItem = { text: string; directorate: string; versionId: string; bulletId: string };
export type ConsolidatedTopic = { title: string; items: ConsolidatedItem[] };
export type Consolidated = { title: string; summary: string; topics: ConsolidatedTopic[]; aiUsed: boolean; warning?: string };

/** Сводка как документ справки — для показа и выгрузки PDF/Word теми же средствами, что и обычная справка. */
export function consolidatedToDoc(c: Consolidated): MemoDoc {
  let n = 0;
  const bullet = (text: string) => ({ id: `c${n++}`, text, itemIds: [], origin: "manual" as const, edited: true, hidden: false, sourceHash: "" });
  return {
    sections: [
      ...(c.summary ? [{ id: "summary", title: "Главное", kind: "section" as const, bullets: [bullet(c.summary)] }] : []),
      ...c.topics.map((t, i) => ({
        id: `t${i}`,
        title: t.title,
        kind: "section" as const,
        // у пункта, собранного ИИ, дирекция дописывается, если ИИ сам её не назвал
        bullets: t.items.map((it) => bullet(c.aiUsed && it.directorate && !it.text.includes(it.directorate) ? `${it.text} (${it.directorate})` : it.text)),
      })),
    ],
  };
}
