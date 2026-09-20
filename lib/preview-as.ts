import { useSyncExternalStore } from "react";

/**
 * Режим «Посмотреть как руководитель» (только для куратора): интерфейс показывается так, как его видит выбранный
 * руководитель — меню, кнопки и права на правку. Это только вид на стороне браузера: сессия остаётся куратора,
 * а все действия записи в этом режиме отключены, поэтому ничего не может измениться от чужого имени.
 * Хранится в sessionStorage (до закрытия вкладки).
 */
export type PreviewUser = { id: string; name: string };

const KEY = "operativka.previewAs";
let current: PreviewUser | null | undefined; // undefined — ещё не читали из хранилища
const listeners = new Set<() => void>();

function read(): PreviewUser | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PreviewUser) : null;
  } catch {
    return null;
  }
}

export function getPreview(): PreviewUser | null {
  if (typeof window === "undefined") return null;
  if (current === undefined) current = read();
  return current;
}

export function setPreview(user: PreviewUser | null): void {
  current = user;
  try {
    if (user) sessionStorage.setItem(KEY, JSON.stringify(user));
    else sessionStorage.removeItem(KEY);
  } catch {
    // без хранилища режим просто не переживёт перезагрузку
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Руководитель, глазами которого сейчас смотрит куратор (или null). */
export function usePreviewAs(): PreviewUser | null {
  return useSyncExternalStore(subscribe, getPreview, () => null);
}
