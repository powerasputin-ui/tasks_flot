"use client";

import { useState } from "react";
import { isLongChange } from "@/lib/audit-format";

const COLLAPSE_OVER = 120;

/**
 * Одно изменение поля в журнале: «Поле»: было → стало.
 * Короткие значения — в одну строку со стрелкой. Длинные (и с переводами строк) — блоками
 * «Было / Стало» с переносом любых слов, свёрнутыми до трёх строк и кнопкой «Показать полностью».
 * Нужен внутри контейнера-блока (div): длинный вариант выводит блочные элементы.
 */
export function AuditChange({ label, before, after }: { label: string; before: string; after: string }) {
  const [open, setOpen] = useState(false);

  if (!isLongChange(before, after)) {
    return (
      <>
        «{label}»: <span className="text-outline">{before}</span> → <span className="font-semibold">{after}</span>
      </>
    );
  }

  const collapsible = before.length > COLLAPSE_OVER || after.length > COLLAPSE_OVER || before.split("\n").length > 3 || after.split("\n").length > 3;
  return (
    <>
      «{label}»:
      <span className="mt-1.5 block space-y-1.5">
        <Block tag="Было" text={before} open={open} muted />
        <Block tag="Стало" text={after} open={open} />
        {collapsible && (
          <button onClick={() => setOpen((o) => !o)} className="text-[12px] font-semibold text-primary hover:underline">
            {open ? "Свернуть" : "Показать полностью"}
          </button>
        )}
      </span>
    </>
  );
}

function Block({ tag, text, open, muted }: { tag: string; text: string; open: boolean; muted?: boolean }) {
  return (
    <span className="flex gap-2">
      <span className="w-10 shrink-0 pt-px text-[10px] font-bold uppercase tracking-wide text-outline">{tag}</span>
      <span className={`min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] ${open ? "" : "line-clamp-3"} ${muted ? "text-outline" : "font-medium text-on-surface"}`}>{text}</span>
    </span>
  );
}
