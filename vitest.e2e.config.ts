import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "path";

/**
 * E2E-набор API: вызывает настоящие маршруты приложения (app/api/**) на БД из .env.
 * Сессия подменяется (входить паролем не нужно), все тестовые данные помечены и удаляются по завершении.
 * Запуск: npm run test:e2e — ТОЛЬКО на локальной или временной базе (см. проверку ниже).
 */
const env = loadEnv("", process.cwd(), "");

// Набор заводит учётные записи, чистит данные и гоняет рассылки на «будущие» даты: каждому, у чьей задачи срок раньше
// этой даты, уходит настоящее напоминание. На боевой базе это письма живым людям — поэтому, как и браузерные тесты
// (e2e/ui/global-setup.ts), набор отказывается работать не на локальной базе. Осознанно на другой — E2E_ALLOW_REMOTE_DB=1.
if (env.DATABASE_URL && !/@(localhost|127\.0\.0\.1|postgres)(:\d+)?\//.test(env.DATABASE_URL) && env.E2E_ALLOW_REMOTE_DB !== "1") {
  throw new Error(
    "E2E API: DATABASE_URL указывает не на локальную базу — набор создаёт и удаляет данные и шлёт уведомления людям. " +
      "Запускайте на локальной или временной базе (npm run db:local). Осознанно на другой — E2E_ALLOW_REMOTE_DB=1."
  );
}

// Удалённая база отвечает медленно: даём запросам подождать свободного соединения дольше стандартных 10 секунд.
if (env.DATABASE_URL && !env.DATABASE_URL.includes("pool_timeout")) env.DATABASE_URL += (env.DATABASE_URL.includes("?") ? "&" : "?") + "pool_timeout=60";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.ts"],
    env,
    testTimeout: 150_000,
    // удалённая база иногда рвёт соединение (Windows 10054) — повторяем упавший тест, а не всю проверку
    retry: 2,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
