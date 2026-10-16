// Служебный воркер: делает сайт устанавливаемым («на экран Домой») и показывает понятную страницу, когда нет связи.
// Данные НЕ кэшируются: рабочая информация не должна оставаться на устройстве, а чужие правки — не показываться устаревшими.
const OFFLINE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Нет связи</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#f3f4f9;color:#191c20}
main{max-width:22rem;padding:1.5rem;text-align:center}h1{font-size:1.1rem;margin:0 0 .5rem}p{margin:0 0 1rem;color:#5b6270;font-size:.9rem}
button{border:0;border-radius:.5rem;background:#0059a5;color:#fff;padding:.6rem 1.2rem;font-size:.95rem}</style></head>
<body><main><h1>Нет связи с сервером</h1><p>Проверьте подключение к интернету. Данные на этом устройстве не хранятся — после восстановления связи всё откроется как обычно.</p>
<button onclick="location.reload()">Повторить</button></main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const req = event.request;
  // всё, кроме переходов по страницам, идёт прямо в сеть
  if (req.mode !== "navigate") return;
  event.respondWith(fetch(req).catch(() => new Response(OFFLINE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
