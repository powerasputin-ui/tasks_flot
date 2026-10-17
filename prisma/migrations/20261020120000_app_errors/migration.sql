-- Журнал ошибок прода. Добавляющая миграция.
CREATE TABLE IF NOT EXISTS "app_errors" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "stack" TEXT,
  "role" TEXT,
  "count" INTEGER NOT NULL DEFAULT 1,
  "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_errors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "app_errors_fingerprint_key" ON "app_errors"("fingerprint");
CREATE INDEX IF NOT EXISTS "app_errors_lastAt_idx" ON "app_errors"("lastAt");
