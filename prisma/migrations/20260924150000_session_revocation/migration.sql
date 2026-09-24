-- Отзыв сессий: токены, выданные раньше этой отметки, недействительны. Только добавление.
ALTER TABLE "users" ADD COLUMN "sessionsValidAfter" TIMESTAMP(3);
