/**
 * Резервная копия всех таблиц в JSON — перед очисткой данных и миграциями ТЗ v4.
 * Пишет в backups/<дата-время>/<таблица>.json (папка в .gitignore: внутри
 * хэши паролей и рабочие данные).
 *
 * Запуск: npm run backup-db
 * Восстановление: отдельным скриптом при необходимости (формат — массив строк Prisma).
 */
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TABLES: Record<string, () => Promise<unknown[]>> = {
  users: () => prisma.user.findMany(),
  segments: () => prisma.segment.findMany(),
  attractiveness: () => prisma.attractiveness.findMany(),
  statuses: () => prisma.status.findMany(),
  tracks: () => prisma.track.findMany(),
  tasks: () => prisma.task.findMany(),
  vessel_options: () => prisma.vesselOption.findMany(),
  audit_events: () => prisma.auditEvent.findMany(),
  weekly_updates: () => prisma.weeklyUpdate.findMany(),
  weekly_digests: () => prisma.weeklyDigest.findMany(),
  comments: () => prisma.comment.findMany(),
  notifications: () => prisma.notification.findMany(),
  canvas_items: () => prisma.canvasItem.findMany(),
};

async function withRetry<T>(fn: () => Promise<T>, attempts = 6, delayMs = 3000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`Попытка ${i + 1}/${attempts} не удалась (соединение с Neon), повтор…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join("backups", stamp);
  fs.mkdirSync(dir, { recursive: true });

  const counts: Record<string, number> = {};
  for (const [name, load] of Object.entries(TABLES)) {
    const rows = await withRetry(load);
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(rows, null, 2), "utf8");
    counts[name] = rows.length;
    console.log(`${name}: ${rows.length}`);
  }
  fs.writeFileSync(path.join(dir, "_counts.json"), JSON.stringify(counts, null, 2), "utf8");
  console.log(`\nГотово: ${dir}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
