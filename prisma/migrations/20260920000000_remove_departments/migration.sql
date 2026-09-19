-- AlterEnum (переименование сохраняет роли существующих пользователей)
ALTER TYPE "UserRole" RENAME VALUE 'DEPARTMENT_HEAD' TO 'HEAD';

-- DropForeignKey
ALTER TABLE "operational_items" DROP CONSTRAINT "operational_items_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_departmentId_fkey";

-- DropIndex
DROP INDEX "operational_items_departmentId_idx";

-- DropIndex
DROP INDEX "users_departmentId_idx";

-- AlterTable
ALTER TABLE "operational_items" DROP COLUMN "departmentId";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "departmentId";

-- DropTable
DROP TABLE "departments";

