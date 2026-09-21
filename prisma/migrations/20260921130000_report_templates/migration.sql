-- CreateEnum
CREATE TYPE "ReportScope" AS ENUM ('PERSONAL', 'SHARED');

-- CreateTable
CREATE TABLE "report_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "scope" "ReportScope" NOT NULL DEFAULT 'PERSONAL',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_templates_ownerId_idx" ON "report_templates"("ownerId");

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

