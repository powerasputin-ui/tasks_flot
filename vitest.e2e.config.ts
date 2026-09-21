import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "path";

/**
 * E2E-набор API: вызывает настоящие маршруты приложения (app/api/**) на реальной БД из .env.
 * Сессия подменяется (входить паролем не нужно), все тестовые данные помечены и удаляются по завершении.
 * Запуск: npm run test:e2e
 */
// Удалённая база отвечает медленно: даём запросам подождать свободного соединения дольше стандартных 10 секунд.
const env = loadEnv("", process.cwd(), "");
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
