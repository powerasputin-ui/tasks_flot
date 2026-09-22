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
  direction = "down",
  hover = false,
  width,
  className = "",
}: {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  direction?: "down" | "up";
  /** Открывать при наведении курсора (по клику тоже работает — для сенсорных экранов). */
  hover?: boolean;
  width?: number | string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enter = () => {
    if (!hover) return;
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setOpen(true);
  };
  const leave = () => {
    if (!hover) return;
    leaveTimer.current = setTimeout(() => setOpen(false), 180);
  };

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
    <div ref={ref} className={`relative ${className}`} onMouseEnter={enter} onMouseLeave={leave}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className={`animate-fade-in absolute z-50 rounded-lg border border-outline-variant bg-surface py-1 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          } ${direction === "up" ? "bottom-full mb-1" : "top-full mt-1"}`}
          style={{ width: width ?? 200, maxWidth: "92vw" }}
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
