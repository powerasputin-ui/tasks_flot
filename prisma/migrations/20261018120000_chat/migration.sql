-- Личный чат 1 на 1: диалоги, сообщения, отметки прочитанного. Добавляющая миграция.
CREATE TABLE IF NOT EXISTS "chat_threads" (
  "id" TEXT NOT NULL,
  "userAId" TEXT NOT NULL,
  "userBId" TEXT NOT NULL,
  "startedById" TEXT NOT NULL,
  "zgdSpoke" BOOLEAN NOT NULL DEFAULT false,
  "closedAt" TIMESTAMP(3),
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "itemId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "chat_reads" (
  "threadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("threadId", "userId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "chat_threads_userAId_userBId_key" ON "chat_threads"("userAId", "userBId");
CREATE INDEX IF NOT EXISTS "chat_threads_userAId_lastMessageAt_idx" ON "chat_threads"("userAId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "chat_threads_userBId_lastMessageAt_idx" ON "chat_threads"("userBId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "chat_messages_threadId_createdAt_idx" ON "chat_messages"("threadId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
