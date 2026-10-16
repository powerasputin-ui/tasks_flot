"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const GAP = 8;
const MAX_W = 320;
const DELAY = 350;

/** Светлая карточка-подсказка в стиле приложения (как полный текст в ячейке таблицы). */
export const TIP_CARD = "rounded-md border border-outline-variant bg-surface text-on-surface shadow-lg";

/** Где поставить карточку у элемента: над ним, а если сверху места нет — под ним; по ширине — в пределах экрана. */
export function placeNear(rect: DOMRect, width: number, height: number): CSSProperties {
  const above = rect.top - GAP - height > 8;
  const top = above ? rect.top - GAP - height : Math.min(rect.bottom + GAP, window.innerHeight - height - 8);
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
  return { top: Math.max(8, top), left };
}

/**
 * Подсказки по всему приложению вместо системных: у любого элемента с `title` при наведении (или фокусе с клавиатуры)
 * показывается наша карточка. Сам `title` переезжает в `data-tip` — иначе поверх всплыла бы ещё и браузерная.
 * Ставится один раз в оболочке (AppShell); на сенсорных экранах не работает — там подсказок по наведению нет.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(hover: none)").matches) return;
    let current: Element | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const owner = (t: EventTarget | null) => {
      let el = t instanceof Element ? t : null;
      while (el && !el.hasAttribute("title") && !el.hasAttribute("data-tip")) el = el.parentElement;
      return el;
    };
    const hide = () => {
      current = null;
      if (timer) clearTimeout(timer);
      setTip(null);
    };
    const enter = (e: Event) => {
      const el = owner(e.target);
      if (el === current) return;
      hide();
      if (!el || el.closest("[data-no-tip]")) return;
      current = el;
      const title = el.getAttribute("title");
      if (title !== null) {
        el.setAttribute("data-tip", title);
        el.removeAttribute("title");
        // для экранного диктора подпись остаётся, если у элемента нет своего текста
        if (!el.hasAttribute("aria-label") && !(el.textContent ?? "").trim()) el.setAttribute("aria-label", title);
      }
      const text = el.getAttribute("data-tip") ?? "";
      if (!text.trim()) return;
      timer = setTimeout(() => {
        if (current === el && el.isConnected) setTip({ text, rect: el.getBoundingClientRect() });
      }, DELAY);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && hide();
    document.addEventListener("mouseover", enter);
    document.addEventListener("focusin", enter);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("mouseover", enter);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("mousedown", hide, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // сначала меряем карточку невидимой, потом ставим рядом с элементом
  useEffect(() => {
    if (!tip) return setSize(null);
    const r = card.current?.getBoundingClientRect();
    if (r) setSize({ w: r.width, h: r.height });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={card}
      role="tooltip"
      className={`pointer-events-none fixed z-[70] whitespace-pre-line px-3 py-2 text-[12px] leading-snug [overflow-wrap:anywhere] ${TIP_CARD}`}
      style={{ maxWidth: MAX_W, ...(size ? placeNear(tip.rect, size.w, size.h) : { top: 0, left: 0, visibility: "hidden" }) }}
    >
      {tip.text}
    </div>,
    document.body
  );
}

/** Карточка у точки: по наведению (или закреплённая — по тапу на телефоне). Содержимое — любое. */
export function AnchoredCard({ rect, onEnter, onLeave, onClose, pinned, width = 340, children }: { rect: DOMRect; onEnter?: () => void; onLeave?: () => void; onClose?: () => void; pinned?: boolean; width?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    setH(ref.current?.getBoundingClientRect().height ?? null);
  }, [rect, children]);
  useEffect(() => {
    if (!pinned) return;
    const out = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose?.();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    const t = setTimeout(() => document.addEventListener("mousedown", out), 0);
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", out);
      document.removeEventListener("keydown", key);
    };
  }, [pinned, onClose]);
  const w = Math.min(width, window.innerWidth - 16);
  return createPortal(
    <div
      ref={ref}
      data-no-tip
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={`fixed z-[70] max-h-[50vh] overflow-y-auto p-3 text-[12px] leading-snug ${TIP_CARD}`}
      style={{ width: w, ...(h !== null ? placeNear(rect, w, h) : { top: 0, left: 0, visibility: "hidden" }) }}
    >
      {children}
    </div>,
    document.body
  );
}
