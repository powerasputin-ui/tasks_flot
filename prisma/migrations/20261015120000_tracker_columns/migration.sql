-- Трекер: колонка доски у статуса + статус «На проверке». Только добавляет: старая версия сайта работает с новой базой.
DO $$ BEGIN
  CREATE TYPE "TrackerColumn" AS ENUM ('TODO', 'DOING', 'REVIEW', 'DONE', 'HIDDEN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "statuses" ADD COLUMN IF NOT EXISTS "trackerColumn" "TrackerColumn";

-- «На проверке» встаёт сразу после «В работе» (остальные сдвигаются на одну позицию)
UPDATE "statuses" SET "sortOrder" = "sortOrder" + 1
WHERE "sortOrder" > (SELECT "sortOrder" FROM "statuses" WHERE "name" = 'В работе')
  AND NOT EXISTS (SELECT 1 FROM "statuses" WHERE "name" = 'На проверке');
INSERT INTO "statuses" ("id", "name", "sortOrder", "color", "isActive", "createdAt", "updatedAt")
SELECT 'st_review_' || substr(md5(random()::text), 1, 12), 'На проверке', s."sortOrder" + 1, '#D97706', true, now(), now()
FROM "statuses" s WHERE s."name" = 'В работе'
  AND NOT EXISTS (SELECT 1 FROM "statuses" WHERE "name" = 'На проверке');

UPDATE "statuses" SET "trackerColumn" = 'TODO'   WHERE "trackerColumn" IS NULL AND "name" = 'Не начато';
UPDATE "statuses" SET "trackerColumn" = 'DOING'  WHERE "trackerColumn" IS NULL AND "name" IN ('В работе', 'На паузе', 'На стопе');
UPDATE "statuses" SET "trackerColumn" = 'REVIEW' WHERE "trackerColumn" IS NULL AND "name" = 'На проверке';
UPDATE "statuses" SET "trackerColumn" = 'DONE'   WHERE "trackerColumn" IS NULL AND "name" = 'Завершено';
UPDATE "statuses" SET "trackerColumn" = 'HIDDEN' WHERE "trackerColumn" IS NULL AND "name" = 'Не актуально';
