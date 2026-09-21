import { useSyncExternalStore } from "react";

/**
 * Режим «Посмотреть как»: админ (или директор) видит систему глазами выбранного человека — его меню, данные и права.
 * Режим включает СЕРВЕР (кука, см. /api/view-as): он же отдаёт данные этого человека и запрещает любые изменения.
 * Здесь — только клиентское отражение (для кнопок и подсказок), его выставляет оболочка приложения после загрузки данных.
 */
export type PreviewUser = { id: string; name: string; role?: string };

let current: PreviewUser | null = null;
const listeners = new Set<() => void>();

export function getPreview(): PreviewUser | null {
  return current;
}

export function setPreview(user: PreviewUser | null): void {
  if (current?.id === user?.id) return;
  current = user;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Человек, глазами которого сейчас смотрят (или null). */
export function usePreviewAs(): PreviewUser | null {
  return useSyncExternalStore(subscribe, getPreview, () => null);
}
