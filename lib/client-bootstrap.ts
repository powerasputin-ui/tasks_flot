/**
 * Клиентская часть «одного запроса при открытии»: результат /api/bootstrap запоминается на минуту,
 * поэтому переходы между таблицей, архивом и оперативкой не перезагружают справочники и пользователя.
 * Сбрасывается при выходе и после любых изменений в настройках (clearBootstrap).
 */
export type Bootstrap = {
  user: { id: string; name: string; email: string; role: string; isActive: boolean } | null;
  segments: Array<{ id: string; name: string; color?: string | null }>;
  tracks: Array<{ id: string; name: string; segmentId: string | null }>;
  statuses: Array<{ id: string; name: string }>;
  attractiveness: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string; role: string }>;
  columns: Array<{ id: string; name: string; type: "TEXT" | "NUMBER" | "DATE" | "SELECT"; options: string[] }>;
  tableColumns: unknown;
  /** Дирекция, в которой человек работает (у ЗГД нет). */
  directorate?: { id: string; name: string } | null;
  /** Только админу: дирекции для переключателя. */
  directorates?: Array<{ id: string; name: string }>;
};

const TTL_MS = 60_000;
let cached: { at: number; promise: Promise<Bootstrap | null> } | null = null;

export function loadBootstrap(force = false): Promise<Bootstrap | null> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.promise;
  const promise = fetch("/api/bootstrap")
    .then((r) => (r.ok ? (r.json() as Promise<Bootstrap>) : null))
    .catch(() => null);
  cached = { at: Date.now(), promise };
  // неудачный ответ не запоминаем
  promise.then((v) => {
    if (!v && cached?.promise === promise) cached = null;
  });
  return promise;
}

export function clearBootstrap(): void {
  cached = null;
}
