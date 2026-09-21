-- Роль «Директор дирекции». Остальные роли переименованы только в коде (@map), значения в базе не меняются:
-- CURATOR = ADMIN, MANAGEMENT = EXECUTIVE. Так старая и новая версии приложения работают с одной базой.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DIRECTOR';
