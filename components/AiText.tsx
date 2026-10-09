"use client";

import { Paperclip } from "lucide-react";
import { docHref, type AiDocRef } from "@/lib/ai-docs";

/** Документы, о которых знает ответ (заголовок X-AI-Docs маршрутов ИИ). */
export function readDocsHeader(r: Response): AiDocRef[] | undefined {
  const raw = r.headers.get("X-AI-Docs");
  if (!raw) return undefined;
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(v) ? (v as AiDocRef[]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ответ ИИ: метки [Д1]… превращаются в ссылку на документ (ярлык на файл общего диска — как скрепка в справке).
 * Метка, которой нет в списке (модель ошиблась), остаётся текстом.
 */
export function AiText({ text, docs }: { text: string; docs?: AiDocRef[] }) {
  if (!docs?.length || !/\[Д\d+\]/.test(text)) return <>{text}</>;
  const parts = text.split(/(\[Д\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[Д(\d+)\]$/.exec(p);
        const d = m ? docs.find((x) => x.n === Number(m[1])) : undefined;
        if (!d) return <span key={i}>{p}</span>;
        return (
          <a
            key={i}
            href={docHref(d)}
            download
            title={`Открыть документ «${d.t}» (скачается ярлык — двойной щелчок откроет файл на общем диске)`}
            className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md bg-primary-soft px-1.5 py-0.5 align-baseline text-[12px] font-semibold text-primary hover:underline"
          >
            <Paperclip size={12} className="shrink-0" />
            <span className="truncate">{d.t}</span>
          </a>
        );
      })}
    </>
  );
}
