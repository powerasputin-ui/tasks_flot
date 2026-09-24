-- Подключение ИИ у ЗГД (ключ хранится зашифрованным). Только добавление.
CREATE TABLE "ai_settings" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("userId")
);
