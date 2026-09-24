-- Ограничение частоты запросов (вход, ИИ, напоминания). Только добавление.
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);
