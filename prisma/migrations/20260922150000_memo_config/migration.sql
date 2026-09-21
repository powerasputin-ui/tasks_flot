-- Вид справки: как группировать разделы и из каких полей таблицы собирается текст пункта (настройка дирекции).
ALTER TABLE "directorates" ADD COLUMN "memoConfig" JSONB;
