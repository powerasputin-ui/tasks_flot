-- AlterTable (IF NOT EXISTS: можно выполнить вручную в консоли Neon, повторный prisma migrate deploy не упадёт)
ALTER TABLE "operational_items" ADD COLUMN IF NOT EXISTS "files" JSONB NOT NULL DEFAULT '[]';
