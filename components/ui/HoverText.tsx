"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsClamped } from "@/components/ui/ExpandableText";

const CLAMP: Record<number, string> = { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4" };
const CARD_W = 420;

/**
 * Текст в ячейке таблицы: компактный (несколько строк), а если он обрезан — при наведении
 * рядом появляется карточка с полным текстом. Клик по строке, как и раньше, открывает позицию.
 */
export function HoverText({ text, lines = 3, className = "" }: { text: string; lines?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const clamped = useIsClamped(ref, true, text);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (!clamped || !ref.current) return;
    if (timer.current) clearTimeout(timer.current);
    const r = ref.current.getBoundingClientRect();
    const above = r.bottom + 260 > window.innerHeight && r.top > 260;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - CARD_W - 8)), top: above ? r.top - 6 : r.bottom + 6, above });
  };
  const hide = () => {
    timer.current = setTimeout(() => setPos(null), 150);
  };

  return (
    <>
      <div ref={ref} onMouseEnter={show} onMouseLeave={hide} className={`whitespace-pre-line [overflow-wrap:anywhere] ${CLAMP[lines] ?? CLAMP[3]} ${className}`}>
        {text}
      </div>
      {pos &&
        createPortal(
          <div
            onMouseEnter={() => timer.current && clearTimeout(timer.current)}
            onMouseLeave={hide}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-50 max-h-[50vh] overflow-y-auto rounded-md border border-outline-variant bg-surface p-3.5 text-[13px] font-normal leading-relaxed text-on-surface shadow-lg [overflow-wrap:anywhere]"
            style={{ left: pos.left, top: pos.top, width: CARD_W, maxWidth: "calc(100vw - 16px)", transform: pos.above ? "translateY(-100%)" : undefined }}
          >
            <p className="whitespace-pre-wrap">{text}</p>
          </div>,
          document.body
        )}
    </>
  );
}
