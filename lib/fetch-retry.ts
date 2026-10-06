/**
 * GET с ограничением ожидания и одним повтором. Из России часть запросов до Vercel теряется по дороге и не доходит до сервера
 * вовсе (замер 06.10.2026: примерно каждый шестой; в журнале Vercel от таких запросов нет ни строки), а сам сервер отвечает
 * за доли секунды. Поэтому первую попытку ждём недолго (timeoutMs, 8 с) и повторяем — повтор почти всегда проходит.
 * На повтор даём в 2,5 раза больше: если ответ просто медленный (утром просыпается база), второй раз его дождёмся.
 * Повторяем только чтение (GET) и только при обрыве, зависании или «шлюз не дождался» (502/503/504) — не при ошибках данных.
 */
export async function fetchRetry(url: string, init: RequestInit = {}, delayMs = 300, timeoutMs = 8000): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const attempt = (ms: number) => fetch(url, { ...init, signal: withTimeout(init.signal, ms) });
  if (method !== "GET") return fetch(url, init);
  try {
    const res = await attempt(timeoutMs);
    if (res.status !== 502 && res.status !== 503 && res.status !== 504) return res;
  } catch (e) {
    // отмену самим человеком (уход со страницы) не повторяем; зависание по нашему таймеру — повторяем
    if (init.signal?.aborted) throw e;
  }
  await new Promise((r) => setTimeout(r, delayMs));
  return attempt(Math.round(timeoutMs * 2.5));
}

/** Сигнал, который срабатывает по таймеру или по внешней отмене — что раньше. */
export function withTimeout(outer: AbortSignal | null | undefined, ms: number): AbortSignal {
  const timer = AbortSignal.timeout(ms);
  return outer ? AbortSignal.any([outer, timer]) : timer;
}

/**
 * Запрос без побочных действий (вопрос ИИ, сборка сводки), который сам по себе может идти долго: ограничиваем только
 * время до НАЧАЛА ответа (заголовков). Не начал отвечать за firstByteMs — зависший экземпляр, повторяем один раз.
 * Начатый длинный ответ не обрывается.
 */
export async function fetchFirstByteRetry(url: string, init: RequestInit, firstByteMs: number): Promise<Response> {
  const attempt = async () => {
    const ctl = new AbortController();
    const outer = init.signal;
    const onOuter = () => ctl.abort(outer?.reason);
    outer?.addEventListener("abort", onOuter);
    const timer = setTimeout(() => ctl.abort(new DOMException("first byte timeout", "TimeoutError")), firstByteMs);
    try {
      return await fetch(url, { ...init, signal: ctl.signal });
    } finally {
      clearTimeout(timer);
      // после заголовков внешняя отмена (кнопка «Стоп») по-прежнему обрывает чтение ответа
    }
  };
  try {
    return await attempt();
  } catch (e) {
    if (init.signal?.aborted) throw e;
    return attempt();
  }
}
