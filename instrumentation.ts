/**
 * Запуск экземпляра сервера — в журнал Vercel: регион и время.
 * Нужно для поиска зависаний: видно, совпадает ли зависший запрос с запуском нового экземпляра.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  console.log(`[boot] экземпляр запущен at=${new Date().toISOString()} region=${process.env.VERCEL_REGION ?? "-"}`);
}
