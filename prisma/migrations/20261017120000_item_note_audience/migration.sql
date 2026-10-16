-- Комментарии к задаче: кто их видит (дирекция или ещё и ЗГД). Только добавляет столбец; можно выполнить вручную в консоли Neon
-- и повторно (IF NOT EXISTS). Старая версия кода столбец не использует: у её записей будет значение по умолчанию.
ALTER TABLE "item_notes" ADD COLUMN IF NOT EXISTS "audience" TEXT NOT NULL DEFAULT 'INTERNAL';
