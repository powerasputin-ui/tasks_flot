/**
 * Полная резервная копия данных в JSON — перед миграциями и рискованными операциями: все таблицы базы, а не заранее
 * выбранные. Пишет в backups/<дата-время>[-метка]/<таблица>.json и _meta.json (дата, версия кода, какие миграции были
 * применены, число строк в каждой таблице). Папка в .gitignore: внутри хэши паролей и рабочие данные.
 *
 * Запуск: npm run backup-db                         — копия базы из .env (локальной)
 *         npm run backup-db -- --env=.env.neon      — копия боевой базы (только чтение)
 *         npm run backup-db -- --label=перед-чисткой — добавить метку к имени папки
 * Восстановление: npm run restore-db -- backups/<папка>
 * Эта копия — «рабочая» (перед миграцией, для переноса данных). Ежедневная боевая копия — pg_dump в .github/workflows/db-backup.yml.
 */
import { PrismaClient } from "@prisma/client";
import { databaseUrl, makeBackup } from "./db-snapshot";

const arg = (name: string) => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  const url = databaseUrl(arg("env"));
  if (!url) throw new Error("Не найден DATABASE_URL (в окружении, в .env или в файле из --env=).");
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const { dir, meta } = await makeBackup(prisma, { label: arg("label"), url });
    const rows = Object.values(meta.tables).reduce((a, b) => a + b, 0);
    console.log(`\nГотово: ${dir} — таблиц ${Object.keys(meta.tables).length}, строк ${rows}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
