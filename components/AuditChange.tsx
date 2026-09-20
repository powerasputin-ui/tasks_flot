"use client";

import { ExpandableText } from "@/components/ui/ExpandableText";
import { isLongChange } from "@/lib/audit-format";

/**
 * Одно изменение поля в журнале: «Поле»: было → стало.
 * Короткие значения — в одну строку со стрелкой. Длинные (и с абзацами) — двумя карточками
 * «Было» / «Стало»: слова любой длины переносятся, каждая карточка свёрнута до 3 строк,
 * а «Показать полностью» появляется, только если текст действительно обрезан.
 * Нужен внутри контейнера-блока (div): длинный вариант выводит блочные элементы.
 */
export function AuditChange({ label, before, after }: { label: string; before: string; after: string }) {
  if (!isLongChange(before, after)) {
    return (
      <>
        «{label}»: <span className="text-outline">{before}</span> → <span className="font-semibold">{after}</span>
      </>
    );
  }

  return (
    <>
      «{label}»:
      <div className="mt-1.5 space-y-1.5">
        <Quote tag="Было" text={before} tone="old" />
        <Quote tag="Стало" text={after} tone="new" />
      </div>
    </>
  );
}

function Quote({ tag, text, tone }: { tag: string; text: string; tone: "old" | "new" }) {
  const old = tone === "old";
  return (
    <div className={`rounded-md border-l-[3px] bg-surface-low py-2 pl-3 pr-3 ${old ? "border-status-red/50" : "border-status-emerald"}`}>
      <span className={`mb-0.5 block text-[10px] font-bold uppercase tracking-wide ${old ? "text-status-red/80" : "text-status-emerald"}`}>{tag}</span>
      <ExpandableText text={text} lines={3} className={`text-[12px] leading-relaxed ${old ? "text-on-surface-variant" : "text-on-surface"}`} />
    </div>
  );
}
