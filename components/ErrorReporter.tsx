"use client";

import { useEffect } from "react";

/** Отправить ошибку страницы в журнал (Настройки → «Ошибки»). Одинаковые за сеанс — один раз, всего не больше 10. */
const sent = new Set<string>();
export function reportClientError(error: unknown) {
  if (typeof window === "undefined" || sent.size >= 10) return;
  const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Ошибка без текста");
  // шум браузера и расширений, а не наши поломки
  if (/ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:/i.test(`${e.message} ${e.stack ?? ""}`)) return;
  const key = `${e.message}|${location.pathname}`;
  if (sent.has(key)) return;
  sent.add(key);
  void fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: e.message, stack: e.stack ?? null, route: location.pathname }), keepalive: true }).catch(() => {});
}

/** Ловит необработанные ошибки и отклонённые обещания на любой странице. Ничего не рисует. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => reportClientError(ev.error ?? ev.message);
    const onRejection = (ev: PromiseRejectionEvent) => reportClientError(ev.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
