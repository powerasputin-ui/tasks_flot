"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

/**
 * Пункт верхнего меню со всплывающим подменю («Общая таблица» → «Удалённые»). Сам пункт — обычная ссылка; при наведении
 * (или фокусе с клавиатуры, или по шеврону) под ним появляется карточка с вложенными пунктами.
 * Карточка рисуется порталом: меню лежит в блоке с прокруткой, и обычный выпадающий блок внутри него обрезался бы.
 */
export function NavDropdown({ href, label, active, items }: { href: string; label: string; active: boolean; items: Array<{ href: string; label: string; icon?: ReactNode }> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = () => {
    if (timer.current) clearTimeout(timer.current);
    if (wrap.current) setRect(wrap.current.getBoundingClientRect());
  };
  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRect(null), 160);
  };

  useEffect(() => {
    if (!rect) return;
    const hide = () => setRect(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && hide();
    document.addEventListener("keydown", key);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [rect]);

  const tone = active ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface";
  return (
    <div ref={wrap} className="flex shrink-0 items-stretch" onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={(e) => !wrap.current?.contains(e.relatedTarget as Node) && close()}>
      <Link href={href} className={`flex items-center whitespace-nowrap border-b-2 pl-3 pr-1 text-[13px] font-semibold transition-colors ${tone}`}>
        {label}
      </Link>
      <button
        type="button"
        onClick={() => (rect ? setRect(null) : open())}
        aria-label={`${label}: ещё`}
        aria-haspopup="menu"
        aria-expanded={!!rect}
        className={`flex items-center border-b-2 pl-0.5 pr-2 transition-colors ${tone}`}
      >
        <ChevronDown size={14} className={`transition-transform ${rect ? "rotate-180" : ""}`} />
      </button>
      {rect &&
        createPortal(
          <div
            role="menu"
            onMouseEnter={open}
            onMouseLeave={close}
            className="animate-fade-in fixed z-50 min-w-48 rounded-lg border border-outline-variant bg-surface py-1 shadow-xl"
            style={{ top: rect.bottom, left: rect.left }}
          >
            {items.map((i) => (
              <Link key={i.href} href={i.href} role="menuitem" onClick={() => setRect(null)} className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-on-surface transition-colors hover:bg-primary-soft">
                {i.icon && <span className="shrink-0 text-outline">{i.icon}</span>}
                <span className="flex-1 truncate">{i.label}</span>
              </Link>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
