"use client";

import { FileText, Paperclip } from "lucide-react";
import { docHref, type AiDocRef } from "@/lib/ai-docs";
import type { AiItemRef } from "@/lib/ai-table";

function readJsonHeader<T>(r: Response, name: string): T[] | undefined {
  const raw = r.headers.get(name);
  if (!raw) return undefined;
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(v) ? (v as T[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Документы, о которых знает ответ (заголовок X-AI-Docs маршрутов ИИ). */
export const readDocsHeader = (r: Response) => readJsonHeader<AiDocRef>(r, "X-AI-Docs");
/** Позиции таблицы, о которых знает ответ (заголовок X-AI-Items). */
export const readItemsHeader = (r: Response) => readJsonHeader<AiItemRef>(r, "X-AI-Items");

/**
 * Ответ ИИ: метки [Д1]… — ссылка на документ (ярлык на файл общего диска, как скрепка в справке),
 * [Т7]… — ссылка на позицию в таблице. Метка, которой нет в списке (модель ошиблась), остаётся текстом.
 */
export function AiText({ text, docs, items }: { text: string; docs?: AiDocRef[]; items?: AiItemRef[] }) {
  if (!(docs?.length || items?.length) || !/\[[ДТ]\d+\]/.test(text)) return <>{text}</>;
  const parts = text.split(/(\[[ДТ]\d+\])/g);
  const chip = "mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md bg-primary-soft px-1.5 py-0.5 align-baseline text-[12px] font-semibold text-primary hover:underline";
  return (
    <>
      {parts.map((p, i) => {
        const d = /^\[Д(\d+)\]$/.exec(p);
        if (d) {
          const doc = docs?.find((x) => x.n === Number(d[1]));
          if (!doc) return <span key={i}>{p}</span>;
          return (
            <a key={i} href={docHref(doc)} download title={`Открыть документ «${doc.t}» (скачается ярлык — двойной щелчок откроет файл на общем диске)`} className={chip}>
              <Paperclip size={12} className="shrink-0" />
              <span className="truncate">{doc.t}</span>
            </a>
          );
        }
        const t = /^\[(Т\d+)\]$/.exec(p);
        const item = t ? items?.find((x) => x.l === t[1]) : undefined;
        if (!item) return <span key={i}>{p}</span>;
        return (
          <a key={i} href={`/table?item=${item.i}`} target="_blank" rel="noreferrer" title={`Открыть позицию в таблице: «${item.t}…»`} className={chip}>
            <FileText size={12} className="shrink-0" />
            <span>{item.l}</span>
          </a>
        );
      })}
    </>
  );
}
