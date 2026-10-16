-- Чат: группы, чат по задаче, несколько задач и упоминания. Добавляющая миграция.
ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'DIRECT';
ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "itemId" TEXT;
ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;
ALTER TABLE "chat_threads" ALTER COLUMN "userAId" DROP NOT NULL;
ALTER TABLE "chat_threads" ALTER COLUMN "userBId" DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "chat_threads_itemId_key" ON "chat_threads"("itemId");
CREATE TABLE IF NOT EXISTS "chat_members" (
  "threadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "addedById" TEXT,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_members_pkey" PRIMARY KEY ("threadId", "userId")
);
CREATE INDEX IF NOT EXISTS "chat_members_userId_idx" ON "chat_members"("userId");
DO $$ BEGIN
  ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'TEXT';
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "itemIds" JSONB;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "mentionIds" JSONB;
-- участники существующих личных диалогов (повторный запуск безопасен)
INSERT INTO "chat_members" ("threadId", "userId", "role", "joinedAt") SELECT "id", "userAId", 'MEMBER', "createdAt" FROM "chat_threads" WHERE "kind" = 'DIRECT' AND "userAId" IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO "chat_members" ("threadId", "userId", "role", "joinedAt") SELECT "id", "userBId", 'MEMBER', "createdAt" FROM "chat_threads" WHERE "kind" = 'DIRECT' AND "userBId" IS NOT NULL ON CONFLICT DO NOTHING;
