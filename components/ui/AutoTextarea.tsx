"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/** Поле, которое растёт по мере ввода (до maxHeight), а дальше прокручивается. */
export function AutoTextarea({ value, maxHeight = 260, className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; maxHeight?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, maxHeight)}px`;
  }, [value, maxHeight]);
  return <textarea ref={ref} value={value} rows={2} className={`input w-full resize-none overflow-y-auto [overflow-wrap:anywhere] ${className}`} {...rest} />;
}
