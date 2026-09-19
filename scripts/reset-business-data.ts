/**
 * ТЗ v4, раздел 9: удалить рабочие данные, оставив людей (фамилии/учётные записи),
 * справочники и структуру таблицы. Удаляются: Track, Task, VesselOption,
 * WeeklyUpdate, WeeklyDigest, Comment, Notification, CanvasItem, AuditEvent
 * и тестовый пользователь "Тестовый Ответственный" (ТЗ v4, п.11-Б).
 *
 * БЕЗОПАСНОСТЬ: по умолчанию dry-run (только показывает, что будет удалено).
 * Реальное удаление — только с флагом --confirm и только если в backups/ есть
 * свежая копия (создаётся `npm run backup-db`).
 *
 * Запуск: npm run reset-business-data            # dry-run
 *         npm run reset-business-data -- --confirm
 */
import fs from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONFIRM = process.argv.includes("--confirm");
const TEST_USER_NAME = "Тестовый Ответственный";
const MAX_BACKUP_AGE_MS = 6 * 60 * 60 * 1000;

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

function hasFreshBackup(): boolean {
  if (!fs.existsSync("backups")) return false;
  return fs.readdirSync("backups").some((d) => {
    const counts = `backups/${d}/_counts.json`;
    return fs.existsSync(counts) && Date.now() - fs.statSync(counts).mtimeMs < MAX_BACKUP_AGE_MS;
  });
}

async function main() {
  const before = {
    tracks: await withRetry(() => prisma.track.count()),
    tasks: await prisma.task.count(),
    vesselOptions: await prisma.vesselOption.count(),
    weeklyUpdates: await prisma.weeklyUpdate.count(),
    weeklyDigests: await prisma.weeklyDigest.count(),
    comments: await prisma.comment.count(),
    notifications: await prisma.notification.count(),
    canvasItems: await prisma.canvasItem.count(),
    auditEvents: await prisma.auditEvent.count(),
    users: await prisma.user.count(),
  };
  const testUsers = await prisma.user.findMany({ where: { name: TEST_USER_NAME }, select: { id: true, name: true } });

  console.log("Будет удалено:", JSON.stringify({ ...before, users: undefined }));
  console.log(`Тестовых пользователей к удалению: ${testUsers.length} (${TEST_USER_NAME}); остальные пользователи (${before.users - testUsers.length}) сохраняются`);

  if (!CONFIRM) {
    console.log("\nDRY-RUN: ничего не удалено. Для удаления: npm run reset-business-data -- --confirm");
    return;
  }
  if (!hasFreshBackup()) {
    console.error("\nОТКАЗ: нет свежей резервной копии (моложе 6 часов). Сначала: npm run backup-db");
    process.exit(2);
  }

  // Порядок учитывает внешние ключи.
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.canvasItem.deleteMany(),
    prisma.weeklyUpdate.deleteMany(),
    prisma.weeklyDigest.deleteMany(),
    prisma.auditEvent.deleteMany(),
    prisma.task.deleteMany(),
    prisma.vesselOption.deleteMany(),
    prisma.track.deleteMany(),
    prisma.user.deleteMany({ where: { name: TEST_USER_NAME } }),
  ]);
  console.log("\nГотово: рабочие данные удалены, пользователи и справочники сохранены.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
