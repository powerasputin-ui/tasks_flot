"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// Классы прописаны целиком, чтобы Tailwind их увидел.
const CLAMP: Record<number, string> = {
  1: "line-clamp-1",
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  5: "line-clamp-5",
  6: "line-clamp-6",
};

/**
 * Обрезан ли текст на самом деле (а не «похоже, что длинный»): сравниваем полную и видимую высоту.
 * Перемеряется при смене текста и ширины (панель, окно), пока текст свёрнут.
 */
export function useIsClamped(ref: RefObject<HTMLElement | null>, active: boolean, text: string): boolean {
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active, text]);
  return clamped;
}

/**
 * Длинный текст: по умолчанию свёрнут до нескольких строк, переносит слова любой длины
 * и сохраняет абзацы. Кнопка «Показать полностью» появляется только если текст реально обрезан.
 */
export function ExpandableText({ text, lines = 3, className = "" }: { text: string; lines?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const clamped = useIsClamped(ref, !open, text);

  return (
    <div>
      <div ref={ref} className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${open ? "" : CLAMP[lines] ?? CLAMP[3]} ${className}`}>
        {text}
      </div>
      {(clamped || open) && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 inline-flex items-center gap-0.5 text-[12px] font-semibold text-primary hover:underline">
          {open ? "Свернуть" : "Показать полностью"}
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      )}
    </div>
  );
}
