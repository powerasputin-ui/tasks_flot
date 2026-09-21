-- Дирекции. Только добавления и замена уникальных индексов на составные; данные переносятся в единственную дирекцию.
-- Старая версия приложения продолжает работать с этой схемой (новые столбцы необязательные).

CREATE TABLE "directorates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "directorates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "directorates_name_key" ON "directorates"("name");

-- Единственная пока дирекция; название берём из настройки, если её меняли.
INSERT INTO "directorates" ("id", "name")
VALUES (
    'dir_fleet',
    COALESCE((SELECT value #>> '{}' FROM "app_settings" WHERE "key" = 'directorate.name'), 'Дирекция по развитию флота и коммерческой эксплуатации')
);

ALTER TABLE "users" ADD COLUMN "directorateId" TEXT;
ALTER TABLE "segments" ADD COLUMN "directorateId" TEXT;
ALTER TABLE "tracks" ADD COLUMN "directorateId" TEXT;
ALTER TABLE "operational_items" ADD COLUMN "directorateId" TEXT;
ALTER TABLE "cycles" ADD COLUMN "directorateId" TEXT;
ALTER TABLE "custom_columns" ADD COLUMN "directorateId" TEXT;
ALTER TABLE "report_templates" ADD COLUMN "directorateId" TEXT;

-- Всё существующее принадлежит этой дирекции. ЗГД (MANAGEMENT) в дирекции не состоит.
UPDATE "users" SET "directorateId" = 'dir_fleet' WHERE "role" <> 'MANAGEMENT';
UPDATE "segments" SET "directorateId" = 'dir_fleet';
UPDATE "tracks" SET "directorateId" = 'dir_fleet';
UPDATE "operational_items" SET "directorateId" = 'dir_fleet';
UPDATE "cycles" SET "directorateId" = 'dir_fleet';
UPDATE "custom_columns" SET "directorateId" = 'dir_fleet';
UPDATE "report_templates" SET "directorateId" = 'dir_fleet' WHERE "scope" = 'SHARED';

-- Раскладка таблицы становится настройкой дирекции (ключ с суффиксом); прежняя остаётся для старой версии.
INSERT INTO "app_settings" ("key", "value", "updatedAt")
SELECT 'table.columns:dir_fleet', "value", CURRENT_TIMESTAMP FROM "app_settings" WHERE "key" = 'table.columns'
ON CONFLICT ("key") DO NOTHING;

-- Названия сегментов и номера циклов уникальны в пределах дирекции.
DROP INDEX "segments_name_key";
DROP INDEX "cycles_number_key";
CREATE UNIQUE INDEX "segments_directorateId_name_key" ON "segments"("directorateId", "name");
CREATE UNIQUE INDEX "cycles_directorateId_number_key" ON "cycles"("directorateId", "number");
CREATE INDEX "operational_items_directorateId_idx" ON "operational_items"("directorateId");

ALTER TABLE "users" ADD CONSTRAINT "users_directorateId_fkey" FOREIGN KEY ("directorateId") REFERENCES "directorates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "segments" ADD CONSTRAINT "segments_directorateId_fkey" FOREIGN KEY ("directorateId") REFERENCES "directorates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_directorateId_fkey" FOREIGN KEY ("directorateId") REFERENCES "directorates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operational_items" ADD CONSTRAINT "operational_items_directorateId_fkey" FOREIGN KEY ("directorateId") REFERENCES "directorates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_directorateId_fkey" FOREIGN KEY ("directorateId") REFERENCES "directorates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "custom_columns" ADD CONSTRAINT "custom_columns_directorateId_fkey" FOREIGN KEY ("directorateId") REFERENCES "directorates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_directorateId_fkey" FOREIGN KEY ("directorateId") REFERENCES "directorates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
