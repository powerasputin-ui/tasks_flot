/**
 * Режим «Посмотреть как»: любые изменения запрещены. Но часть POST-запросов ничего не меняет — они лишь строят отчёт
 * (для сложной настройки отчёта нужно тело запроса), поэтому в режиме просмотра их пропускаем, а также выход из режима и из системы.
 */
const ALLOWED: RegExp[] = [/^\/api\/view-as$/, /^\/api\/auth\/logout$/, /^\/api\/report$/, /^\/api\/cycles\/[^/]+\/report$/];

export function isViewOnlyAllowed(pathname: string): boolean {
  return ALLOWED.some((r) => r.test(pathname));
}

/** Запрос запрещён в режиме просмотра: это API, метод не читающий и путь не в списке разрешённых. */
export function blockedInViewOnly(method: string, pathname: string): boolean {
  return pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method) && !isViewOnlyAllowed(pathname);
}
