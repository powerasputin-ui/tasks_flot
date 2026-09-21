-- Справка директора: разделы справки (у каждой дирекции свои, в них входят треки), черновик справки и дата совещания у цикла.
-- Только добавления: старая версия приложения продолжает работать.

ALTER TABLE "directorates" ADD COLUMN "shortName" TEXT;

CREATE TABLE "memo_sections" (
    "id" TEXT NOT NULL,
    "directorateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memo_sections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "memo_sections_directorateId_idx" ON "memo_sections"("directorateId");
ALTER TABLE "memo_sections" ADD CONSTRAINT "memo_sections_directorateId_fkey" FOREIGN KEY ("directorateId") REFERENCES "directorates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tracks" ADD COLUMN "memoSectionId" TEXT;
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_memoSectionId_fkey" FOREIGN KEY ("memoSectionId") REFERENCES "memo_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cycles" ADD COLUMN "meetingDate" TIMESTAMP(3);
ALTER TABLE "cycles" ADD COLUMN "memoDraft" JSONB;
ALTER TABLE "cycles" ADD COLUMN "memoVersion" INTEGER NOT NULL DEFAULT 0;
