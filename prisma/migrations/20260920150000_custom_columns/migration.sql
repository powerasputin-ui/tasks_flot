-- CreateEnum
CREATE TYPE "CustomColumnType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT');

-- AlterTable
ALTER TABLE "operational_items" ADD COLUMN     "customValues" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "custom_columns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomColumnType" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_columns_pkey" PRIMARY KEY ("id")
);

