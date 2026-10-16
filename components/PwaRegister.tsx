"use client";

import { useEffect, useState } from "react";

/** Событие установки браузер отдаёт один раз за загрузку страницы — держим его, пока человек не нажмёт «Установить». */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Регистрация служебного воркера (только в рабочей сборке) и перехват события установки. Ничего не рисует. */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* без воркера сайт работает как обычно — просто нельзя установить */
      });
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred = e as InstallPrompt;
      notify();
    };
    const onInstalled = () => {
      deferred = null;
      notify();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

/** Для кнопки «Установить»: можно ли установить прямо сейчас, запуск установки, и признак «уже установлено / iPhone». */
export function useInstall(): { canInstall: boolean; install: () => Promise<void>; standalone: boolean; ios: boolean } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  return {
    canInstall: !!deferred && !standalone,
    install: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      notify();
    },
    standalone,
    ios,
  };
}
