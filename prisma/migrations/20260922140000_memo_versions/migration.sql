-- Отправка справки ЗГД: неизменяемые версии справки (архив, поиск, сравнение), ревизия цикла, уведомления.
-- Только добавления: старая версия приложения продолжает работать.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MEMO_SENT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MEMO_RETURNED';

ALTER TABLE "cycles" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "memo_versions" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "directorateId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "meetingDate" TIMESTAMP(3),
    "doc" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "participation" JSONB NOT NULL,
    "note" TEXT,
    "searchText" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "sentByName" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "returnComment" TEXT,
    "returnedByName" TEXT,

    CONSTRAINT "memo_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "memo_versions_cycleId_revision_key" ON "memo_versions"("cycleId", "revision");
CREATE INDEX "memo_versions_directorateId_sentAt_idx" ON "memo_versions"("directorateId", "sentAt");
ALTER TABLE "memo_versions" ADD CONSTRAINT "memo_versions_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memo_versions" ADD CONSTRAINT "memo_versions_directorateId_fkey" FOREIGN KEY ("directorateId") REFERENCES "directorates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
