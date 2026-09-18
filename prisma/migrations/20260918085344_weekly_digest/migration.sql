-- CreateEnum
CREATE TYPE "WeeklyDigestStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateTable
CREATE TABLE "weekly_digests" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT NOT NULL,
    "status" "WeeklyDigestStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,

    CONSTRAINT "weekly_digests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_digests_weekStart_key" ON "weekly_digests"("weekStart");

-- AddForeignKey
ALTER TABLE "weekly_digests" ADD CONSTRAINT "weekly_digests_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
