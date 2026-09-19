"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Выезжающая справа панель (как «Аналитика выборки» в образце): не затемняет
 * таблицу, закрывается крестиком и Esc. На узких экранах занимает всю ширину.
 */
export function Panel({
  title,
  subtitle,
  onClose,
  footer,
  children,
  width = 440,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      className="animate-slide-in fixed bottom-0 right-0 top-16 z-40 flex w-full flex-col border-l border-outline-variant bg-surface shadow-2xl"
      style={{ maxWidth: width }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant bg-surface-low px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-semibold leading-6 text-on-surface">{title}</h2>
          {subtitle && <div className="mt-0.5 text-[12px] text-on-surface-variant">{subtitle}</div>}
        </div>
        <button onClick={onClose} className="btn-icon -mr-2 h-8 w-8 shrink-0" title="Закрыть (Esc)">
          <X size={17} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="border-t border-outline-variant bg-surface-low px-5 py-3">{footer}</div>}
    </aside>
  );
}
