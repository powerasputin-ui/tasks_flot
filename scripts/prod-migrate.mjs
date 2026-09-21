/**
 * Применяет миграции к БОЕВОЙ базе (адрес в .env.neon). Запускать перед выкладкой, когда в проекте появились новые миграции.
 * Миграции проекта только добавляют (старая версия сайта продолжает работать), поэтому порядок такой:
 *   1) npm run db:prod:migrate   2) git push (Vercel соберёт новую версию).
 * Запуск: npm run db:prod:migrate
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const env = { ...process.env };
for (const line of fs.readFileSync(".env.neon", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
  if (m) env[m[1]] = m[2];
}
const run = (args) => spawnSync("npx", ["prisma", ...args], { stdio: "inherit", env, shell: true }).status ?? 1;

console.log("Боевая база: состояние миграций");
run(["migrate", "status"]);
console.log("\nПрименяю недостающие миграции к боевой базе…");
process.exit(run(["migrate", "deploy"]));
