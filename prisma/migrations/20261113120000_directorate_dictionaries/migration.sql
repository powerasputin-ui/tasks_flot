-- Статусы и шкала «Внимание» — настраиваемые в каждой дирекции: к общим значениям (directorateId пуст) дирекция добавляет свои.
-- Только добавление: новый необязательный столбец; уникальность названия — внутри дирекции (у общих — как раньше, проверяет приложение).
-- Старая версия сайта продолжает работать: столбец она не читает, общие значения не меняются.
ALTER TABLE "statuses" ADD COLUMN IF NOT EXISTS "directorateId" TEXT;
ALTER TABLE "attractiveness" ADD COLUMN IF NOT EXISTS "directorateId" TEXT;

DROP INDEX IF EXISTS "statuses_name_key";
DROP INDEX IF EXISTS "attractiveness_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "statuses_directorateId_name_key" ON "statuses"("directorateId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "attractiveness_directorateId_name_key" ON "attractiveness"("directorateId", "name");
-- у общих значений (directorateId IS NULL) уникальность названия проверяет приложение: NULL в уникальном индексе не равны друг другу
CREATE INDEX IF NOT EXISTS "statuses_directorateId_idx" ON "statuses"("directorateId");
CREATE INDEX IF NOT EXISTS "attractiveness_directorateId_idx" ON "attractiveness"("directorateId");

DO $$ BEGIN
  ALTER TABLE "statuses" ADD CONSTRAINT "statuses_directorateId_fkey" FOREIGN KEY ("directorateId") REFERENCES "directorates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "attractiveness" ADD CONSTRAINT "attractiveness_directorateId_fkey" FOREIGN KEY ("directorateId") REFERENCES "directorates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
