/**
 * Создаёт (или обновляет пароль у) администратора системы — роль SYSTEM_ADMIN.
 * E-mail и пароль берутся из переменных окружения ПРИ ЗАПУСКЕ и нигде не
 * сохраняются в репозитории:
 *
 *   PowerShell:  $env:ADMIN_EMAIL="admin@example.com"; $env:ADMIN_PASSWORD="длинный-пароль"; npm run create-admin
 *   bash:        ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='длинный-пароль' npm run create-admin
 *
 * Необязательно: ADMIN_NAME (по умолчанию "Администратор").
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function withRetry<T>(fn: () => Promise<T>, attempts = 6, delayMs = 3000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`Попытка ${i + 1}/${attempts} не удалась (соединение с БД), повтор…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Администратор";

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Задайте корректный ADMIN_EMAIL");
  if (!password || password.length < 8) throw new Error("ADMIN_PASSWORD должен быть не короче 8 символов");

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await withRetry(() => prisma.user.findUnique({ where: { email } }));

  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: "SYSTEM_ADMIN", passwordHash, isActive: true } });
    console.log(`Обновлён администратор: ${email} (роль SYSTEM_ADMIN, пароль изменён)`);
  } else {
    await prisma.user.create({ data: { name, email, passwordHash, role: "SYSTEM_ADMIN" } });
    console.log(`Создан администратор: ${email}`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
