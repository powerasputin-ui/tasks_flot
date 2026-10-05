// Проверка связи без базы: отличить зависание платформы от зависания базы.
const started = Date.now();
export function GET() {
  return Response.json({ ok: true, uptimeMs: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
}
