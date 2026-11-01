/**
 * Применяет миграции к БОЕВОЙ базе (адрес в .env.neon). Запускать перед выкладкой, когда в проекте появились новые миграции:
 *   1) npm run db:prod:migrate   2) git push (Vercel соберёт новую версию).
 *
 * Что делает, по порядку:
 *   1. Показывает, к какой базе подключился (хост и имя, без пароля) — чтобы не применить миграции к чужой.
 *   2. Сверяет миграции проекта с журналом самой базы. Останавливается, ничего не меняя, если миграция в базе начата и не
 *      завершена, если в базе есть миграции, которых нет в проекте (не та база или устаревший код), или журнала нет совсем.
 *   3. Если применять нечего — на этом всё.
 *   4. Иначе снимает полную копию данных в backups/<время>-prod-before-migrate и только потом применяет. Не удалось снять — не применяет.
 *   5. Проверяет, что после применения ничего не осталось.
 * Миграции проекта только добавляют (старая версия сайта продолжает работать), но удалять из них тоже случалось —
 * копия до миграции и есть точка возврата данных.
 *
 * Запуск: npm run db:prod:migrate
 * Только проверить, ничего не меняя: npm run db:prod:migrate -- --dry-run
 * Другой файл с адресом (для проверок на временной базе): PROD_ENV_FILE=путь
 */
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { describeDatabase, makeBackup, readEnvFile } from "./db-snapshot";
import { classifyMigrations, localMigrations, readJournal } from "./migration-state";

const dryRun = process.argv.includes("--dry-run");
const envFile = process.env.PROD_ENV_FILE ?? ".env.neon";

function stop(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

async function main() {
  // значения из файла важнее окружения — как и было: боевой адрес не должен подмениться случайной переменной
  const env = { ...process.env, ...readEnvFile(envFile) };
  const url = env.DATABASE_URL;
  if (!url) stop(`В ${envFile} нет DATABASE_URL.`);
  const target = describeDatabase(url);
  console.log(`Боевая база: ${target?.host} / ${target?.name}`);

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const local = localMigrations();
    const state = classifyMigrations(local, await readJournal(prisma));
    console.log(`Миграций в проекте: ${local.length}, применено в базе: ${state.applied.length}.`);
    if (state.problems.length) stop(`Стоп, ничего не изменено:\n- ${state.problems.join("\n- ")}`);
    if (!state.pending.length) {
      console.log("Боевая база актуальна — применять нечего.");
      return;
    }
    console.log(`К применению (${state.pending.length}):\n- ${state.pending.join("\n- ")}`);
    if (dryRun) {
      console.log("\nПроверка без изменений (--dry-run): копию не снимал, миграции не применял.");
      return;
    }

    console.log("\nСнимаю полную копию данных перед миграциями…");
    let backupDir: string;
    try {
      backupDir = (await makeBackup(prisma, { label: "prod-before-migrate", url })).dir;
    } catch (e) {
      stop(`Копию снять не удалось — миграции НЕ применены.\n${e instanceof Error ? e.message : e}`);
    }
    console.log(`\nКопия: ${backupDir}\nПрименяю недостающие миграции…`);
    const code = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env, shell: true }).status ?? 1;
    if (code !== 0) stop(`prisma migrate deploy завершился с ошибкой (код ${code}). Копия данных до миграций: ${backupDir}.`);

    const after = classifyMigrations(local, await readJournal(prisma));
    if (after.pending.length || after.problems.length) {
      stop(`После применения в базе остались проблемы: ${[...after.problems, ...after.pending.map((m) => `не применена ${m}`)].join("; ")}. Копия до миграций: ${backupDir}.`);
    }
    console.log(`\nГотово: применено миграций — ${state.pending.length}. Копия до миграций: ${backupDir}. Теперь git push.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
