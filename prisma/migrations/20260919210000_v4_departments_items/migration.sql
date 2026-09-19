-- AlterEnum
BEGIN;
CREATE TYPE "AuditAction_new" AS ENUM ('CREATE', 'UPDATE', 'STATUS_CHANGE', 'DEADLINE_CHANGE', 'OWNER_CHANGE', 'ATTRACTIVENESS_CHANGE', 'OPER_FLAG_CHANGE', 'ARCHIVE', 'RESTORE');
ALTER TABLE "audit_events" ALTER COLUMN "action" TYPE "AuditAction_new" USING ("action"::text::"AuditAction_new");
ALTER TYPE "AuditAction" RENAME TO "AuditAction_old";
ALTER TYPE "AuditAction_new" RENAME TO "AuditAction";
DROP TYPE "public"."AuditAction_old";
COMMIT;

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SUBMISSION_MISSING';

-- AlterEnum (переименование значений сохраняет роли существующих пользователей)
ALTER TYPE "UserRole" RENAME VALUE 'RESPONSIBLE' TO 'DEPARTMENT_HEAD';
ALTER TYPE "UserRole" RENAME VALUE 'MANAGER' TO 'MANAGEMENT';
ALTER TYPE "UserRole" ADD VALUE 'SYSTEM_ADMIN';

-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_authorId_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_operSetById_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_statusId_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_trackId_fkey";

-- DropForeignKey
ALTER TABLE "tracks" DROP CONSTRAINT "tracks_attractivenessId_fkey";

-- DropForeignKey
ALTER TABLE "tracks" DROP CONSTRAINT "tracks_operSetById_fkey";

-- DropForeignKey
ALTER TABLE "tracks" DROP CONSTRAINT "tracks_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "tracks" DROP CONSTRAINT "tracks_statusId_fkey";

-- DropForeignKey
ALTER TABLE "vessel_options" DROP CONSTRAINT "vessel_options_attractivenessId_fkey";

-- DropForeignKey
ALTER TABLE "vessel_options" DROP CONSTRAINT "vessel_options_statusId_fkey";

-- DropForeignKey
ALTER TABLE "vessel_options" DROP CONSTRAINT "vessel_options_trackId_fkey";

-- DropForeignKey
ALTER TABLE "weekly_digests" DROP CONSTRAINT "weekly_digests_generatedById_fkey";

-- DropForeignKey
ALTER TABLE "weekly_updates" DROP CONSTRAINT "weekly_updates_authorId_fkey";

-- DropForeignKey
ALTER TABLE "weekly_updates" DROP CONSTRAINT "weekly_updates_trackId_fkey";

-- DropIndex
DROP INDEX "tracks_ownerId_idx";

-- DropIndex
DROP INDEX "tracks_segmentId_idx";

-- DropIndex
DROP INDEX "tracks_statusId_idx";

-- AlterTable
ALTER TABLE "audit_events" ADD COLUMN     "afterSubmission" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tracks" DROP COLUMN "archivedAt",
DROP COLUMN "attractivenessId",
DROP COLUMN "description",
DROP COLUMN "operFlag",
DROP COLUMN "operSetAt",
DROP COLUMN "operSetById",
DROP COLUMN "ownerId",
DROP COLUMN "statusId",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "departmentId" TEXT;

-- DropTable
DROP TABLE "canvas_items";

-- DropTable
DROP TABLE "comments";

-- DropTable
DROP TABLE "tasks";

-- DropTable
DROP TABLE "vessel_options";

-- DropTable
DROP TABLE "weekly_digests";

-- DropTable
DROP TABLE "weekly_updates";

-- DropEnum
DROP TYPE "WeeklyDigestStatus";

-- DropEnum
DROP TYPE "WeeklyUpdateStatus";

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_items" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "segmentId" TEXT,
    "trackId" TEXT,
    "title" TEXT NOT NULL,
    "cost" TEXT,
    "attractivenessId" TEXT,
    "responsibleId" TEXT,
    "deadline" TIMESTAMP(3),
    "statusId" TEXT,
    "comment" TEXT,
    "operFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "operational_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_notes" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE INDEX "operational_items_departmentId_idx" ON "operational_items"("departmentId");

-- CreateIndex
CREATE INDEX "operational_items_segmentId_idx" ON "operational_items"("segmentId");

-- CreateIndex
CREATE INDEX "operational_items_trackId_idx" ON "operational_items"("trackId");

-- CreateIndex
CREATE INDEX "operational_items_statusId_idx" ON "operational_items"("statusId");

-- CreateIndex
CREATE INDEX "operational_items_responsibleId_idx" ON "operational_items"("responsibleId");

-- CreateIndex
CREATE INDEX "operational_items_deadline_idx" ON "operational_items"("deadline");

-- CreateIndex
CREATE INDEX "operational_items_archivedAt_idx" ON "operational_items"("archivedAt");

-- CreateIndex
CREATE INDEX "item_notes_itemId_idx" ON "item_notes"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_segmentId_name_key" ON "tracks"("segmentId", "name");

-- CreateIndex
CREATE INDEX "users_departmentId_idx" ON "users"("departmentId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_items" ADD CONSTRAINT "operational_items_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_items" ADD CONSTRAINT "operational_items_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_items" ADD CONSTRAINT "operational_items_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_items" ADD CONSTRAINT "operational_items_attractivenessId_fkey" FOREIGN KEY ("attractivenessId") REFERENCES "attractiveness"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_items" ADD CONSTRAINT "operational_items_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_items" ADD CONSTRAINT "operational_items_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_items" ADD CONSTRAINT "operational_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_items" ADD CONSTRAINT "operational_items_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_notes" ADD CONSTRAINT "item_notes_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "operational_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_notes" ADD CONSTRAINT "item_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

