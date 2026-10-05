/**
 * GET с ограничением ожидания и одним повтором. На Vercel изредка зависает запуск нового экземпляра серверной функции
 * (запрос висит минуту и больше), а утром ещё и база просыпается. Корпоративный прокси такой запрос обрывает — «сайт не
 * работает». Поэтому: ждём не дольше timeoutMs, затем повторяем — повтор почти всегда попадает на рабочий экземпляр.
 * Повторяем только чтение (GET) и только при обрыве, зависании или «шлюз не дождался» (502/503/504) — не при ошибках данных.
 */
export async function fetchRetry(url: string, init: RequestInit = {}, delayMs = 1000, timeoutMs = 15000): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const once = () => fetch(url, { ...init, signal: withTimeout(init.signal, timeoutMs) });
  if (method !== "GET") return fetch(url, init);
  try {
    const res = await once();
    if (res.status !== 502 && res.status !== 503 && res.status !== 504) return res;
  } catch (e) {
    // отмену самим человеком (уход со страницы) не повторяем; зависание по нашему таймеру — повторяем
    if (init.signal?.aborted) throw e;
  }
  await new Promise((r) => setTimeout(r, delayMs));
  return once();
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
