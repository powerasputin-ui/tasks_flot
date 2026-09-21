-- Составитель справки: назначается админом (директор и админ ведут справку по своей роли).
ALTER TABLE "users" ADD COLUMN "memoEditor" BOOLEAN NOT NULL DEFAULT false;
