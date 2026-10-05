-- AlterTable (IF NOT EXISTS: можно выполнить вручную в консоли Neon, повторный prisma migrate deploy не упадёт)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "submits" BOOLEAN NOT NULL DEFAULT false;
