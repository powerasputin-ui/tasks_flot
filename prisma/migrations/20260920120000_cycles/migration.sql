-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'FINAL');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ITEM_RETURNED';

-- CreateTable
CREATE TABLE "cycles" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStartedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "remindersSentAt" TIMESTAMP(3),
    "snapshot" JSONB,

    CONSTRAINT "cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cycles_number_key" ON "cycles"("number");

-- CreateIndex
CREATE INDEX "cycles_status_idx" ON "cycles"("status");

