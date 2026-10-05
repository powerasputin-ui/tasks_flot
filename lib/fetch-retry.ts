/**
 * GET с одним повтором. Утром после простоя сервер и база просыпаются до 30–40 с, и корпоративный прокси может оборвать
 * первый запрос раньше. Повтор через пару секунд приходит уже к проснувшемуся серверу.
 * Повторяем только чтение (GET) и только при обрыве связи или «шлюз не дождался» (502/503/504) — не при ошибках данных.
 */
export async function fetchRetry(url: string, init: RequestInit = {}, delayMs = 1500): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const once = () => fetch(url, init);
  if (method !== "GET") return once();
  try {
    const res = await once();
    if (res.status !== 502 && res.status !== 503 && res.status !== 504) return res;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
  }
  await new Promise((r) => setTimeout(r, delayMs));
  return once();
}
