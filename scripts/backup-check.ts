/**
 * Проверка, что резервная копия действительно восстанавливается. Копия, которую ни разу не пробовали развернуть, — догадка:
 * схема меняется, а восстановление ломается молча и обнаруживается в аварии.
 *
 * Снимает копию с базы из .env, рядом создаёт пустую базу <имя>_restore_check, накатывает на неё миграции, загружает копию и
 * сверяет каждую таблицу построчно; затем удаляет проверочную базу и временные файлы. Данные в основной базе не меняются.
 * Только для локальной базы: проверка создаёт и удаляет базу.
 *
 * Запуск: npm run backup-check   (локально — при запущенной npm run db:local; в CI — после тестов)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import { databaseUrl, describeDatabase, isLocalDatabase, makeBackup, readBackup, restoreBackup } from "./db-snapshot";

async function main() {
  const url = databaseUrl();
  if (!url || !isLocalDatabase(url)) throw new Error("Защита: проверка создаёт и удаляет базу — только на локальной (адрес в .env).");
  const checkName = `${describeDatabase(url)!.name}_restore_check`;
  const checkUrl = new URL(url);
  checkUrl.pathname = `/${checkName}`;

  const admin = new PrismaClient({ datasourceUrl: url });
  const target = new PrismaClient({ datasourceUrl: checkUrl.toString() });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backup-check-"));
  try {
    // проверочная база — с той же кодировкой и сортировкой, что у основной (на Windows локальная база не UTF8)
    const [{ enc, collate, ctype }] = await admin.$queryRawUnsafe<Array<{ enc: string; collate: string; ctype: string }>>(
      `SELECT pg_encoding_to_char(encoding)::text AS enc, datcollate::text AS collate, datctype::text AS ctype FROM pg_database WHERE datname = current_database()`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${checkName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${checkName}" TEMPLATE template0 ENCODING '${enc}' LC_COLLATE '${collate}' LC_CTYPE '${ctype}'`);
    // схема в пустой базе — теми же миграциями, что и везде
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: checkUrl.toString() }, shell: true, encoding: "utf8" });
    if (migrate.status !== 0) throw new Error(`prisma migrate deploy в проверочной базе не прошёл:\n${migrate.stdout}${migrate.stderr}`);

    const { dir, meta } = await makeBackup(admin, { root: tmp, url, log: () => {} });
    // каждая модель схемы должна оказаться в копии (новая таблица не должна выпадать из резервного копирования)
    const missing = Prisma.dmmf.datamodel.models.map((m) => m.dbName ?? m.name).filter((t) => !(t in meta.tables));
    if (missing.length) throw new Error(`В копию не попали таблицы схемы: ${missing.join(", ")}`);

    await restoreBackup(target, readBackup(dir), { log: () => {} });
    const rows = Object.values(meta.tables).reduce((a, b) => a + b, 0);
    console.log(`Копия восстанавливается: таблиц ${Object.keys(meta.tables).length}, строк ${rows}, каждая таблица сверена с файлом.`);
  } finally {
    await target.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${checkName}" WITH (FORCE)`).catch(() => {});
    await admin.$disconnect();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
