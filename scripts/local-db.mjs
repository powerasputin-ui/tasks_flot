/**
 * Локальная база для разработки: настоящий PostgreSQL, запускаемый прямо из проекта (без установки и Docker).
 * Данные лежат в .local-db/ (в .gitignore). Запуск: npm run db:local — окно должно оставаться открытым, пока вы работаете.
 * Остановка: Ctrl+C. Адрес: postgresql://postgres:postgres@localhost:54329/tasksflot
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(".local-db", "data");
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port: 54329, persistent: true, onLog: () => {}, onError: (e) => console.error(String(e)) });

if (!fs.existsSync(path.join(dir, "PG_VERSION"))) {
  console.log("Первый запуск: создаю локальную базу…");
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase("tasksflot");
} catch {
  // база уже есть
}
console.log("Локальная база запущена: postgresql://postgres:postgres@localhost:54329/tasksflot");
console.log("Не закрывайте это окно. Остановка: Ctrl+C.");

const stop = async () => {
  console.log("\nОстанавливаю базу…");
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30); // держим процесс живым
