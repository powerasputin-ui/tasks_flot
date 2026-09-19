"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Выпадающий блок под элементом-триггером: закрывается по клику снаружи и Esc.
 * Используется для меню, чипов-фильтров, поповеров настроек.
 */
export function Popover({
  trigger,
  children,
  align = "left",
  width,
  className = "",
}: {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: number | string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className={`animate-fade-in absolute top-full z-50 mt-1 rounded-lg border border-outline-variant bg-surface py-1 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
          style={{ minWidth: width ?? 200 }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  active,
  danger,
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-primary-soft ${
        danger ? "text-status-red" : active ? "font-semibold text-primary" : "text-on-surface"
      }`}
    >
      {icon && <span className="shrink-0 text-outline">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}
