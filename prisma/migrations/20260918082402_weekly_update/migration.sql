-- CreateEnum
CREATE TYPE "WeeklyUpdateStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'WEEKLY_UPDATE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'WEEKLY_UPDATE_SUBMITTED';

-- CreateTable
CREATE TABLE "weekly_updates" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "whatDone" TEXT,
    "currentState" TEXT,
    "nextSteps" TEXT,
    "risks" TEXT,
    "needManagerHelp" BOOLEAN NOT NULL DEFAULT false,
    "status" "WeeklyUpdateStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "weekly_updates_trackId_idx" ON "weekly_updates"("trackId");

-- CreateIndex
CREATE INDEX "weekly_updates_authorId_idx" ON "weekly_updates"("authorId");

-- CreateIndex
CREATE INDEX "weekly_updates_weekStart_idx" ON "weekly_updates"("weekStart");

-- AddForeignKey
ALTER TABLE "weekly_updates" ADD CONSTRAINT "weekly_updates_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_updates" ADD CONSTRAINT "weekly_updates_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
