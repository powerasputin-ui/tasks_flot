-- Трекер 2.0: поручение (результат, исходный срок, блокер, отмена, источник ЗГД, контроль), сдача/приёмка,
-- подтверждения для ЗГД, запросы ЗГД, запросы переноса срока. Только добавляет; можно выполнить вручную в консоли Neon
-- и повторно (IF NOT EXISTS) — повторный prisma migrate deploy тоже не упадёт.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REVIEW_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REVIEW_DECIDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ZGD_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ZGD_ANSWER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ZGD_ORDER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ZGD_COMMENT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DEADLINE_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ZGD_UPDATE';

ALTER TABLE "operational_items" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3);
ALTER TABLE "operational_items" ADD COLUMN IF NOT EXISTS "assignedById" TEXT;
ALTER TABLE "operational_items" ADD COLUMN IF NOT EXISTS "assignedByName" TEXT;
ALTER TABLE "operational_items" ADD COLUMN IF NOT EXISTS "blockedBy" TEXT;
ALTER TABLE "operational_items" ADD COLUMN IF NOT EXISTS "blockedUntil" TIMESTAMP(3);
ALTER TABLE "operational_items" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "operational_items" ADD COLUMN IF NOT EXISTS "expectedResult" TEXT;
ALTER TABLE "operational_items" ADD COLUMN IF NOT EXISTS "origin" TEXT;
ALTER TABLE "operational_items" ADD COLUMN IF NOT EXISTS "originalDeadline" TIMESTAMP(3);
ALTER TABLE "operational_items" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);
ALTER TABLE "operational_items" ADD COLUMN IF NOT EXISTS "zgdControl" BOOLEAN NOT NULL DEFAULT false;

-- исходный срок у уже заведённых задач — текущий (историю переносов до сегодняшнего дня даёт журнал)
UPDATE "operational_items" SET "originalDeadline" = "deadline" WHERE "originalDeadline" IS NULL AND "deadline" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "task_reviews" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedByName" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT NOT NULL,
    "files" JSONB NOT NULL DEFAULT '[]',
    "decision" TEXT,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    CONSTRAINT "task_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_reviews_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "operational_items"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "task_reviews_itemId_idx" ON "task_reviews"("itemId");

CREATE TABLE IF NOT EXISTS "item_publications" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "directorateId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT NOT NULL,
    "publishedByName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    CONSTRAINT "item_publications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "item_publications_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "operational_items"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "item_publications_itemId_publishedAt_idx" ON "item_publications"("itemId", "publishedAt");
CREATE INDEX IF NOT EXISTS "item_publications_directorateId_idx" ON "item_publications"("directorateId");

CREATE TABLE IF NOT EXISTS "zgd_requests" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "directorateId" TEXT NOT NULL,
    "askedById" TEXT NOT NULL,
    "askedByName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answer" TEXT,
    "answeredById" TEXT,
    "answeredByName" TEXT,
    "answeredAt" TIMESTAMP(3),
    CONSTRAINT "zgd_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zgd_requests_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "operational_items"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "zgd_requests_itemId_idx" ON "zgd_requests"("itemId");
CREATE INDEX IF NOT EXISTS "zgd_requests_directorateId_idx" ON "zgd_requests"("directorateId");

CREATE TABLE IF NOT EXISTS "deadline_requests" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "newDeadline" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" TEXT,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    CONSTRAINT "deadline_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deadline_requests_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "operational_items"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "deadline_requests_itemId_idx" ON "deadline_requests"("itemId");
