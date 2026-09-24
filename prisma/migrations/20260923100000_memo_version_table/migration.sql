-- Архив оперативки: у каждой отправленной версии справки — снимок всей таблицы дирекции и её раскладки столбцов.
-- Только добавления: старые версии справки остаются без снимка (для них показывается Cycle.snapshot).
ALTER TABLE "memo_versions" ADD COLUMN "rows" JSONB;
ALTER TABLE "memo_versions" ADD COLUMN "columns" JSONB;
