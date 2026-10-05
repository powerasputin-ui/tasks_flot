/**
 * JSON-ответ для долгой работы (сводка ИИ 15–60 с). Пока результат готовится, каждые несколько секунд уходит пробел:
 * соединение не «молчит», и корпоративный прокси не обрывает его по простою. Пробелы перед JSON допустимы — `res.json()`
 * в браузере их пропускает. Ошибку внутри работы отдаём тем же JSON (статус уже 200 — он ушёл с первым пробелом).
 */
export function jsonWithHeartbeat(work: Promise<unknown>, everyMs = 5000): Response {
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(" "));
      timer = setInterval(() => controller.enqueue(enc.encode(" ")), everyMs);
      work
        .then((v) => controller.enqueue(enc.encode(JSON.stringify(v))))
        .catch(() => controller.enqueue(enc.encode(JSON.stringify({ error: "PROVIDER", message: "ИИ не ответил. Повторите попытку." }))))
        .finally(() => {
          clearInterval(timer);
          controller.close();
        });
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
