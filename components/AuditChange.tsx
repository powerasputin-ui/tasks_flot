"use client";

import { ArrowDown } from "lucide-react";
import { ExpandableText } from "@/components/ui/ExpandableText";
import { isLongChange } from "@/lib/audit-format";

/**
 * Что изменилось в поле: было → стало (само название поля пишет вызывающий: «изменил(а) поле «Комментарий»»).
 * Короткие значения — одной строкой со стрелкой. Длинные (и с абзацами) — двумя спокойными блоками:
 * прежнее значение (серым) и новое, между ними стрелка. Слова любой длины переносятся, блок свёрнут
 * до 3 строк, а «Показать полностью» появляется, только если текст действительно обрезан.
 */
export function AuditChange({ before, after }: { before: string; after: string }) {
  if (!isLongChange(before, after)) {
    return (
      <div className="mt-0.5 [overflow-wrap:anywhere]">
        <span className="text-outline">{before}</span> → <span>{after}</span>
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1">
      <Block text={before} muted />
      <ArrowDown size={13} className="ml-3 text-outline" aria-label="изменено на" />
      <Block text={after} />
    </div>
  );
}

function Block({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <div className="rounded-md bg-surface-low px-3 py-2">
      <ExpandableText text={text} lines={3} className={`text-[12px] leading-relaxed ${muted ? "text-on-surface-variant" : "text-on-surface"}`} />
    </div>
  );
}
