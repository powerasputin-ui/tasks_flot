"use client";

import { useEffect, useState } from "react";

/** Граница «телефон»: уже 768 px (как `md` в Tailwind). */
export const MOBILE_QUERY = "(max-width: 767px)";

/**
 * Телефон или нет — для мест, где разметка на телефоне принципиально другая (таблица → карточки, выпадашка → шторка).
 * Простые подстройки делаются классами `max-md:` / `md:`. До первого рендера в браузере — false (как ПК).
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}
