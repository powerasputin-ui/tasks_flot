-- Индексы по времени для ежедневной уборки и антидубля напоминаний (cron). Только индексы, данные не меняются, старая версия сайта работает.
-- Замер на объёмах «через два года» (150 тыс. уведомлений, 100 тыс. сообщений): антидубль напоминаний 10 мс -> 0,5 мс, чистка чата 21 -> 3 мс.
-- Таблицы небольшие: построение занимает доли секунды, поэтому обычный CREATE INDEX (CONCURRENTLY внутри миграции Prisma не работает).
CREATE INDEX IF NOT EXISTS "notifications_createdAt_idx" ON "notifications"("createdAt");
CREATE INDEX IF NOT EXISTS "chat_messages_createdAt_idx" ON "chat_messages"("createdAt");
