/**
 * Восстановление из копии, снятой backup-db, — в ЛОКАЛЬНУЮ базу из .env (схема в ней должна быть создана: npx prisma migrate deploy).
 * Всё одной транзакцией со сверкой каждой таблицы с файлом: не сошлось — откат, база остаётся как была.
 *
 * Запуск: npm run restore-db -- backups/<папка>           — в свежую базу (после migrate deploy: людей в ней ещё нет)
 *         npm run restore-db -- backups/<папка> --wipe    — в базу с данными: все таблицы очищаются, данные заменяются копией
 * Не локальная база (аварийное восстановление боевой) — только осознанно: RESTORE_ALLOW_REMOTE_DB=1.
 */
import { PrismaClient } from "@prisma/client";
import { databaseUrl, describeDatabase, isLocalDatabase, readBackup, restoreBackup } from "./db-snapshot";

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) throw new Error("Укажите папку копии: npm run restore-db -- backups/<папка> [--wipe]");

  const url = databaseUrl();
  if (!url) throw new Error("Не найден DATABASE_URL (в окружении или в .env).");
  if (!isLocalDatabase(url) && process.env.RESTORE_ALLOW_REMOTE_DB !== "1") {
    throw new Error(`Защита: база в .env не локальная (${describeDatabase(url)?.host ?? "?"}) — восстановление отменено. Осознанно на другую — RESTORE_ALLOW_REMOTE_DB=1.`);
  }

  const backup = readBackup(dir);
  const tables = Object.keys(backup.meta.tables).length;
  const rows = Object.values(backup.meta.tables).reduce((a, b) => a + b, 0);
  const target = describeDatabase(url);
  console.log(`Копия ${dir}: снята ${backup.meta.createdAt}, таблиц ${tables}, строк ${rows}.`);
  console.log(`Восстанавливаю в ${target?.host} / ${target?.name}${args.includes("--wipe") ? " (с очисткой)" : ""}…`);

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await restoreBackup(prisma, backup, { wipe: args.includes("--wipe") });
  } finally {
    await prisma.$disconnect();
  }
  console.log("\nГотово: данные загружены и сверены с копией.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
