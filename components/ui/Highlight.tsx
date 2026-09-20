import { Fragment, type ReactNode } from "react";
import { highlightRegex } from "@/lib/search";

/** Подсвечивает в тексте слова поискового запроса (без учёта регистра, е = ё). Без запроса возвращает текст как есть. */
export function Highlight({ text, query }: { text: string; query?: string }): ReactNode {
  const re = query ? highlightRegex(query) : null;
  if (!re) return text;
  const parts = text.split(re);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((p, i) =>
        // при split с одной группой совпадения стоят на нечётных позициях
        i % 2 === 1 ? (
          <mark key={i} className="rounded-[3px] bg-primary/15 px-0.5 text-inherit">{p}</mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        )
      )}
    </>
  );
}
