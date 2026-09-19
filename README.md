# ГШП Флот-Трекер

Внутреннее корпоративное приложение для управления рабочими треками, задачами,
вариантами судов и еженедельной отчётностью. Полное техническое задание — [TZ.md](./TZ.md),
анализ исходных данных и зафиксированные бизнес-решения/открытые вопросы — [ANALYSIS.md](./ANALYSIS.md).

Текущий статус: **Phase 1 — Foundation + Data Core** (раздел 88 ТЗ).

## Стек

Next.js (App Router) + TypeScript + Prisma + PostgreSQL (Neon) + Tailwind CSS + Zod + Vitest.

## Быстрый старт

```bash
npm install
npm run prisma:generate
npm run prisma:migrate      # применить миграции к БД из DATABASE_URL
npm run db:seed             # справочники (Segment/Status/Attractiveness) + стартовый Куратор
npm run import:excel -- "source-data/Флот-приобретение и коммерция.xlsx"  # первичный импорт (раздел 52)
npm run add-responsible-users -- "source-data/Флот-приобретение и коммерция.xlsx"  # 14 реальных Ответственных + восстановление ownerId
npm run dev
```

Скопируйте `.env.example` в `.env` и укажите реальный `DATABASE_URL` (Neon/любой PostgreSQL)
и `AUTH_SECRET`. Для Neon через pooler-эндпоинт обязательны параметры
`?sslmode=require&connect_timeout=30&pgbouncer=true` — без `pgbouncer=true` Prisma
несовместим с PgBouncer в transaction-режиме, без `connect_timeout=30` первое
подключение может обрываться на "холодном" старте compute.

Стартовый пользователь после `db:seed`: `curator@tasksflot.local` / `ChangeMe123!`
(роль Куратор) — смените пароль или создайте реальные учётные записи через `/settings`.

После `add-responsible-users` 14 реальных людей из Excel (Ответственные) тоже
получают вход: `<транслит.фамилия>.<инициалы>@tasksflot.local` / `ChangeMe123!`
(например `sukhov.va@tasksflot.local`) — список email указывается скриптом
при первом создании, пароль нужно сменить при первом входе.

## Тесты

```bash
npm run test
```

## Структура

```
app/            — маршруты Next.js (App Router) и API-роуты (app/api/*)
lib/            — бизнес-логика: auth, permissions, audit, deadline-week, table-view
components/     — клиентские React-компоненты
prisma/         — schema.prisma, миграции, seed.ts
scripts/        — import-excel.ts (раздел 52-53 ТЗ)
source-data/    — исходный Excel для первичной миграции (раздел 5; после импорта не источник истины)
```

## Что входит в Phase 1, а что нет

Входит (раздел 88): auth, роли, справочники, Track/Task/VesselOption, единая
Table View с фильтрами/сортировкой, Audit Log, импорт Excel.

Сознательно не входит (Phase 2+): WeeklyUpdate, WeeklyDigest, Dashboard, Kanban,
Comments, Notifications, AI, Canvas, Realtime, PPTX, SSO — см. TZ.md раздел 90-96.

## Известные открытые вопросы

См. [ANALYSIS.md](./ANALYSIS.md) — там же зафиксировано, какие решения уже
подтверждены бизнес-заказчиком (например, право Куратора назначать/менять
владельца Track/Task), а какие остаются `UNRESOLVED BUSINESS RULE`.

## Экспорт (Phase 4-5, раздел 55/56/91/92 ТЗ)

* Таблица треков (с текущими фильтрами), Dashboard, дайджест недели — CSV / XLSX / PDF (кнопки «Экспорт» на страницах).
* Дайджест недели — дополнительно PPTX: `WeeklyDigest → ReportData (lib/report-data.ts) → renderer`.
* Права: таблицу выгружают все роли; Dashboard и дайджест — Куратор и Руководитель.
* PDF использует шрифт DejaVu Sans из `assets/fonts/` (кириллица; лицензия рядом).
* Timeline (`/timeline`) — сроки задач по неделям на тех же данных, что таблица.
