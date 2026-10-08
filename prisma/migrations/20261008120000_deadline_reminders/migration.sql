-- AlterEnum (IF NOT EXISTS: можно выполнить вручную в консоли Neon, повторный prisma migrate deploy не упадёт)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DEADLINE_SOON';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DEADLINE_OVERDUE';
