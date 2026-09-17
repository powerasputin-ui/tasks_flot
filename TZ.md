# ТЕХНИЧЕСКОЕ ЗАДАНИЕ

## ГШП ФЛОТ-ТРЕКЕР

Версия: 3.1 (финальная, с уточнением по Kanban/командной работе)
Тип: внутреннее корпоративное web-приложение
Первый контур: пилот на 15 пользователей
Основная задача: управление рабочими треками, задачами, вариантами судов и еженедельной отчетностью

---

## 1. КОНЦЕПЦИЯ ПРОДУКТА

ГШП Флот-Трекер создается как внутренний рабочий инструмент для ГШП.

Продукт должен заменить текущий процесс:

```text
Excel
↓
ручное обновление строк
↓
сбор информации от сотрудников
↓
ручная обработка
↓
ручная подготовка презентации
↓
руководитель
```

на:

```text
Работа сотрудников
↓
Track / Task / VesselOption
↓
WeeklyUpdate
↓
автоматическое определение изменений
↓
WeeklyDigest
↓
руководитель
```

Главный результат продукта:
Руководитель должен быстро понимать, что произошло за неделю, что изменилось, где есть проблемы, какие направления остановились и где требуется его внимание.

---

## 2. ОСНОВНОЙ ПРИНЦИП

Продукт не должен превращаться в копию Notion, AFFiNE или универсальную ERP.

MVP должен решать конкретную задачу: структурировать рабочую информацию и автоматически превращать ее в еженедельную управленческую картину.

---

## 3. ЦЕЛЕВЫЕ ПОЛЬЗОВАТЕЛИ

Первый пилот: 15 пользователей.

Роли:

1. Ответственный
2. Куратор
3. Руководитель

Пользователь может одновременно обладать несколькими бизнес-функциями в будущем, поэтому архитектура не должна жестко связывать одного человека только с одной ролью.
Для MVP достаточно одной основной роли на пользователя.

---

## 4. ОСНОВНОЙ WORKFLOW

**Ответственный**

```text
Вход
↓
Мои Track
↓
Работа с Task
↓
Работа с VesselOption
↓
Изменение статусов/сроков
↓
Комментарии
↓
WeeklyUpdate
↓
Submit
```

**Руководитель**

```text
Dashboard
↓
WeeklyDigest
↓
Изменения
↓
Проблемы
↓
Track
↓
Исходные данные
```

---

## 5. SOURCE DATA

Первоначальный источник данных: `Флот-приобретение_и_коммерция.xlsx`

Исходный анализ содержит:

* 142 строки
* 25 Track
* 93 Task
* 24 VesselOption
* 6 сегментов
* 4 уровня привлекательности
* 5 статусов

Excel используется только как источник первичной миграции.
После импорта Excel перестает быть источником истины.

---

## 6. SOURCE OF TRUTH

Единый источник истины:

```text
PostgreSQL
    ↓
Business Data
```

Файлы: `Object Storage`
Поиск: `Database / Search Index`
История: `Audit Log`
AI: `Derived information`

AI никогда не является источником истины.

---

## 7. DOMAIN MODEL

Основные сущности:

```text
User
Segment
Attractiveness
Status

Track
Task
VesselOption

WeeklyUpdate
WeeklyDigest

Comment
Notification
Attachment

AuditEvent
```

---

## 8. SEGMENT

Справочник сегментов. Исходные значения:

```text
Дноуглубительный флот
Крупнотоннажные перевозки
Оффшорный флот
Портовый флот и ледоколы
Строительный флот
Танкерный флот
```

Модель:

```text
Segment
├── id
├── name
├── color
├── sortOrder
├── isActive
├── createdAt
└── updatedAt
```

---

## 9. ATTRACTIVENESS

Справочник:

```text
ВЫСОКАЯ
ВЫШЕ СРЕДНЕГО
СРЕДНЯЯ
НИЗКАЯ
```

Модель:

```text
Attractiveness
├── id
├── name
├── sortOrder
├── isActive
├── createdAt
└── updatedAt
```

Порядок должен быть конфигурируемым.

---

## 10. STATUS

Начальные статусы:

```text
Не начато
В работе
Завершено
На стопе
Не актуально
```

Модель:

```text
Status
├── id
├── name
├── sortOrder
├── color
├── isActive
├── createdAt
└── updatedAt
```

Статусы не должны быть hard-coded в frontend.

---

## 11. TRACK

Track является основной управленческой сущностью.

```text
Track
├── id
├── segmentId
├── name
├── description
├── attractivenessId
├── statusId
├── ownerId
├── operFlag
├── operSetBy
├── operSetAt
├── createdAt
├── updatedAt
└── archivedAt
```

Track содержит:

```text
Tasks
VesselOptions
WeeklyUpdates
Comments
Audit
Attachments
```

---

## 12. TASK

```text
Task
├── id
├── trackId
├── title
├── description
├── deadline
├── statusId
├── ownerId
├── comment
├── operFlag
├── operSetBy
├── operSetAt
├── createdAt
├── updatedAt
└── archivedAt
```

Task всегда относится к Track.

---

## 13. ДАТА И СРОК

В системе необходимо разделить:

```text
createdAt
updatedAt
deadline
```

`deadline` означает установленный срок выполнения.
Отдельное поле `executionDate` в MVP не вводить, пока его бизнес-смысл не подтвержден.

---

## 14. DEADLINE WEEK

Неделя рассчитывается только от `deadline`.

```text
deadline
↓
ISO week
↓
deadlineWeek
```

Например:

```text
04.05.2026 → Week 19
23.06.2026 → Week 26
06.08.2026 → Week 32
```

Запрещено рассчитывать неделю от `updatedAt`.

---

## 15. VESSEL OPTION

VesselOption является самостоятельной сущностью. Это рассматриваемый вариант судна. Он не является Task.

```text
VesselOption
├── id
├── trackId
├── name
├── cost
├── attractivenessId
├── statusId
├── comment
├── createdAt
├── updatedAt
└── archivedAt
```

Один Track может иметь несколько VesselOption.

---

## 16. COST

На MVP:

```text
cost: string
```

Причина: исходные значения могут иметь диапазоны и текстовую форму:

```text
11,5-12 млн. долл.
28,7 млн.$
```

Не преобразовывать автоматически в numeric.

В будущем возможно:

```text
costMin
costMax
currency
costType
```

---

## 17. OPER FLAG

`operFlag` является Boolean.

Для Track:

```text
operFlag
operSetBy
operSetAt
```

Для Task:

```text
operFlag
operSetBy
operSetAt
```

Изменять его может Куратор.

---

## 18. WEEKLY UPDATE

WeeklyUpdate является центральной сущностью продукта. Он представляет еженедельное обновление конкретного Track.

```text
WeeklyUpdate
├── id
├── trackId
├── authorId
├── weekStart
├── weekEnd
├── whatDone
├── currentState
├── nextSteps
├── risks
├── needManagerHelp
├── status
├── submittedAt
├── createdAt
└── updatedAt
```

---

## 19. WEEKLY UPDATE STATUS

MVP:

```text
DRAFT
SUBMITTED
```

В будущем можно добавить:

```text
RETURNED
APPROVED
```

Но это не входит в MVP.

---

## 20. WEEKLY UPDATE WORKFLOW

```text
DRAFT
↓
ответственный заполняет
↓
SUBMIT
↓
SUBMITTED
```

После Submit WeeklyUpdate сохраняется. Он не должен заменяться следующим WeeklyUpdate. Каждая неделя является отдельной записью.

---

## 21. WEEKLY UPDATE ОБЯЗАТЕЛЬНЫЕ ПОЛЯ

Минимально:

```text
whatDone
currentState
nextSteps
```

Поля:

```text
risks
needManagerHelp
```

могут быть пустыми.

---

## 22. NO UPDATE

Система определяет:

```text
Нет WeeklyUpdate за текущую неделю
```

и:

```text
Нет SUBMITTED WeeklyUpdate 2+ недели
```

Правило:

```text
currentWeek - lastSubmittedWeek >= 2
```

Если update никогда не существовал:

```text
lastSubmittedWeek = NULL
```

и объект должен попадать в отдельную категорию.

---

## 23. WEEKLY DIGEST

WeeklyDigest является сохраненным результатом недельной агрегации.

```text
WeeklyDigest
├── id
├── weekStart
├── weekEnd
├── generatedAt
├── generatedBy
├── status
└── content
```

Статусы:

```text
DRAFT
FINAL
```

---

## 24. WEEKLY DIGEST CONTENT

Digest содержит:

* **Summary** — общая картина
* **Changes** — изменения за неделю
* **By Segment** — разрез по сегментам
* **High Attractiveness** — Track/VesselOption с высокой привлекательностью
* **Stopped** — на стопе
* **Not Relevant** — не актуально
* **No Update** — нет обновлений
* **Manager Help** — требуется помощь руководителя

---

## 25. WEEKLY DIGEST БЕЗ AI

WeeklyDigest должен работать без LLM.

Источник:

```text
Track
Task
VesselOption
WeeklyUpdate
AuditEvent
```

Система сначала формирует детерминированную структуру. AI является дополнительным слоем.

---

## 26. WEEKLY DIFF

Система должна показывать:

```text
Было → Стало
```

для:

* статуса;
* срока;
* ответственного;
* привлекательности;
* operFlag;
* появления записи;
* архивации записи.

---

## 27. AUDIT LOG

Audit реализуется с первого дня. Это не Event Sourcing. Используется append-only журнал изменений.

```text
AuditEvent
├── id
├── entityType
├── entityId
├── actorId
├── timestamp
├── fieldName
├── before
└── after
```

---

## 28. ЧТО ЛОГИРОВАТЬ

Минимально:

```text
CREATE
UPDATE
STATUS_CHANGE
DEADLINE_CHANGE
OWNER_CHANGE
ATTRACTIVENESS_CHANGE
OPER_FLAG_CHANGE
ARCHIVE
WEEKLY_UPDATE_CREATED
WEEKLY_UPDATE_SUBMITTED
```

---

## 29. AUDIT НЕ УДАЛЯЕТСЯ

Обычный пользователь не может удалить AuditEvent. Audit является техническим журналом истории.

---

## 30. TIME TRAVEL

Полноценная функция «Покажи состояние системы на 15 августа» не входит в MVP. Но архитектура Audit должна позволять реализовать ее позднее.

---

## 31. CHANGE ENGINE

Полноценный Change Engine относится к Phase 6 (см. раздел 88). MVP использует упрощенное сравнение текущей недели с предыдущей на основании Audit + WeeklyUpdate.

---

## 32. COMMENTS

```text
Comment
├── id
├── entityType
├── entityId
├── authorId
├── text
├── createdAt
└── updatedAt
```

Поддерживаются:

```text
Track
Task
VesselOption
WeeklyUpdate
```

---

## 33. NOTIFICATIONS

В MVP только in-app. События:

```text
Вас упомянули
WeeklyUpdate требуется заполнить
Изменение требует внимания
Запрос на изменение записи
```

Email не является обязательным.

---

## 34. USERS

```text
User
├── id
├── name
├── email
├── passwordHash
├── role
├── isActive
├── createdAt
└── updatedAt
```

Self-signup отсутствует. Пользователей создаёт администратор.

---

## 35. ROLE: ОТВЕТСТВЕННЫЙ

Может: `READ` по системе.

Для своих объектов:

```text
CREATE
READ
UPDATE
ARCHIVE
```

Объекты:

```text
Track
Task
VesselOption
WeeklyUpdate
```

---

## 36. ROLE: КУРАТОР

Может: `READ ALL`

Управляет:

```text
Segment
Attractiveness
Status
```

Может изменять: `operFlag`

---

## 37. ROLE: РУКОВОДИТЕЛЬ

Может: `READ ALL`

Имеет доступ к:

```text
Dashboard
WeeklyDigest
Export
```

На MVP изменения рабочих данных руководителем не обязательны.

---

## 38. ПРАВИЛА OWNERSHIP

В MVP `ownerId` может быть NULL. Это важно, потому что в исходных данных встречаются записи без ответственного. Система не должна подставлять случайного пользователя.

---

## 39. НЕПОДТВЕРЖДЕННЫЕ ПРАВИЛА

Claude Code не должен самостоятельно решать:

* может ли быть несколько владельцев;
* кто может менять чужой Task;
* кто может менять чужой Track;
* кто может архивировать Track;
* может ли руководитель менять Task;
* можно ли возвращать WeeklyUpdate;
* что именно означает «нужна помощь руководителя».

Если бизнес-правило не подтверждено: `UNRESOLVED BUSINESS RULE`

---

## 40. TABLE VIEW

Главный интерфейс работы. Колонки:

```text
Сегмент
Трек
Тип
Название
Привлекательность
Ответственный
Срок
Неделя
Статус
Опер-флаг
Комментарий
```

---

## 41. TABLE FILTERS

```text
Сегмент
Трек
Тип
Статус
Ответственный
Привлекательность
Неделя
Срок
Опер-флаг
```

---

## 42. TABLE SORT

```text
Срок
Неделя
Статус
Привлекательность
Ответственный
Сегмент
```

---

## 43. KANBAN

Kanban реализуется в Phase 3 (Team Workspace), сразу после закрытия MVP (Phase 0–2) — см. раздел 87. Он не блокирует доказательство основной ценности продукта (структурированные данные + WeeklyUpdate + WeeklyDigest), но входит в основной продукт, а не в отдаленное будущее.

Колонки:

```text
Не начато
В работе
Завершено
На стопе
Не актуально
```

Kanban работает поверх той же модели данных. Никакой отдельной Kanban-БД. Перетаскивание карточки между колонками — это реальное изменение `Task.status`/`Track.status`, которое обязательно попадает в `AuditEvent`.

---

## 44. TRACK PAGE

```text
Track

Сегмент
Привлекательность
Статус
Ответственный

-----------------

Tasks

-----------------

Vessel Options

-----------------

Weekly Updates

-----------------

Comments

-----------------

History
```

---

## 45. DASHBOARD

Dashboard является управленческим экраном. Основные показатели:

```text
Треков в работе
Просроченных задач
Активных задач без срока
Задач без ответственного
Треков на стопе
```

---

## 46. KPI: ПРОСРОЧЕНО

```text
Task.status != Завершено
AND
Task.deadline < today
```

`Не актуально` по умолчанию не считается просроченной.

---

## 47. KPI: БЕЗ СРОКА

```text
Task.status = В работе
AND
deadline IS NULL
```

---

## 48. KPI: БЕЗ ОТВЕТСТВЕННОГО

```text
Task.status = В работе
AND
ownerId IS NULL
```

---

## 49. KPI: НА СТОПЕ

```text
Track.status = На стопе
```

---

## 50. ДОПОЛНИТЕЛЬНЫЕ SIGNALS

Dashboard показывает:

```text
Изменения за неделю
Нет WeeklyUpdate
Нет update 2+ недели
Нужна помощь руководителя
```

---

## 51. SEARCH

MVP: поиск по:

```text
Track
Task
VesselOption
User
```

Поля:

```text
Название
Описание
Комментарий
```

Полнотекстовый поиск документов переносится на последующую фазу.

---

## 52. EXCEL IMPORT

```text
Upload XLSX
↓
Parse
↓
Preview
↓
Mapping
↓
Validation
↓
Import
↓
Report
```

---

## 53. IMPORT VALIDATION

Проверять:

```text
Неизвестный Segment
Неизвестный Status
Неизвестная Attractiveness
Пустой Track
Некорректная дата
Дубликаты
Неизвестный User
```

---

## 54. DATA QUALITY

В исходном Excel обнаружена проблема с некорректным значением Segment `0`. Новая система должна исключать такой класс ошибок путем использования reference/select вместо свободного текста.

---

## 55. EXPORT

MVP:

```text
CSV
XLSX
PDF
```

Экспорт:

```text
Current Table
Dashboard
WeeklyDigest
```

---

## 56. PPTX

PPTX относится к Phase 5 (Reporting + Export). Архитектура:

```text
WeeklyDigest
↓
ReportData
↓
PPTX Renderer
↓
PowerPoint
```

---

## 57. DOCUMENTS

Полноценный DMS не входит в MVP. MVP поддерживает Attachment.

```text
Attachment
├── id
├── entityType
├── entityId
├── filename
├── mimeType
├── size
├── storageKey
├── uploadedBy
└── createdAt
```

---

## 58. FILE STORAGE

Не хранить большие файлы непосредственно в PostgreSQL. Использовать `Object Storage`. PostgreSQL хранит metadata. Для пилота допускается локальное файловое хранилище сервера.

---

## 59. AUTHENTICATION

Для пилота: `Email + Password`. SSO/AD/LDAP не являются обязательными. Для промышленного внедрения отдельно согласовать с ИТ и ИБ ГШП.

---

## 60. AI

AI не является частью обязательного MVP. Архитектура должна предусматривать:

```text
AI Gateway
├── External Provider
└── Local LLM
```

---

## 61. AI SECURITY

Перед включением AI необходимо определить: можно ли отправлять корпоративные данные во внешнюю AI-модель? Если нет — Local LLM или корпоративный AI endpoint.

Claude Code не должен самостоятельно выбирать внешний AI-провайдер.

---

## 62. AI ASSISTANT

После MVP: `Руководитель AI Assistant`.

Пример: «Покажи основные изменения по оффшорному флоту за последние три недели и отдельно покажи то, что требует моего решения.»

AI использует:

```text
Track
Task
VesselOption
WeeklyUpdate
Audit
WeeklyDigest
```

---

## 63. AI CONTEXT

AI получает только разрешенные данные:

```text
User
↓
Permissions
↓
Context
↓
AI
```

Нельзя передавать модели всю БД целиком.

---

## 64. AI EVIDENCE

Каждое существенное утверждение AI должно иметь источник:

```text
claim
sourceType
sourceId
sourceLocation
```

AI должен уметь отвечать: «Недостаточно подтверждающих данных.»

---

## 65. AI НЕ МЕНЯЕТ ДАННЫЕ

AI может только предложить изменение.

```text
AI:
Срок изменен:
18.09 → 24.09

[Применить]
[Отклонить]
```

Фактическое изменение делает пользователь.

---

## 66. AFFINE / BLOCKSUITE

AFFiNE и BlockSuite рассматриваются как технологический источник для будущего editor/collaboration слоя. Не использовать AFFiNE как бизнес-архитектуру.

BlockSuite предоставляет: custom blocks, schema/service/view, persistence, collaborative state, Yjs/CRDT, editor infrastructure.

---

## 67. ЧТО ВЗЯТЬ ИЗ AFFINE

В будущем:

```text
Block architecture
Custom blocks
Rich text
Persistence
Collaboration
Canvas
CRDT/Yjs
```

---

## 68. ЧТО НЕ БРАТЬ ИЗ AFFINE

Не копировать: branding, navigation, visual identity, business logic, information architecture, AI UX.

Не создавать продукт как простой branded fork AFFiNE.

---

## 69. ЧТО ВЗЯТЬ ИЗ NOTION

Взять концепции: один объект → несколько представлений, filters, sorting, grouping, backlinks, linked views, page-like object, search, version/history concept, knowledge organization.

Но бизнес-объекты ГШП должны оставаться типизированными (Track / Task / VesselOption / WeeklyUpdate), а не превращаться в произвольные Notion-блоки.

---

## 70. ARCHITECTURE

MVP:

```text
Next.js
        ↓
Application Layer
        ↓
Domain Modules
        ↓
Prisma
        ↓
PostgreSQL
```

Файлы:

```text
Application
↓
Object Storage
```

---

## 71. MODULAR MONOLITH

Не использовать microservices. Модули:

```text
auth
users
segments
statuses
attractiveness
tracks
tasks
vessel-options
weekly-updates
weekly-digests
audit
comments
notifications
imports
exports
```

---

## 72. TECH STACK

```text
Next.js
React
TypeScript

PostgreSQL
Prisma

Tailwind CSS
Zod

Vitest
Playwright
```

Для графиков: `Recharts` или аналог после проверки совместимости.

---

## 73. DATABASE

Минимальные таблицы:

```text
users
segments
attractiveness
statuses

tracks
tasks
vessel_options

weekly_updates
weekly_digests

comments
notifications
attachments

audit_events
```

---

## 74. DATABASE PRINCIPLES

Каждая сущность: `id`, `createdAt`, `updatedAt`.

Рабочие сущности не удаляются физически. Используется `archivedAt`.

---

## 75. API

```text
/auth
/users

/segments
/attractiveness
/statuses

/tracks
/tasks
/vessel-options

/weekly-updates
/weekly-digests

/audit
/comments
/notifications

/import
/export
```

---

## 76. FRONTEND ROUTES

```text
/login

/dashboard

/tracks
/tracks/[id]

/tasks
/tasks/[id]

/vessel-options
/vessel-options/[id]

/weekly-updates
/weekly-digest

/kanban
/timeline

/settings
/audit
```

---

## 77. NAVIGATION

Основное:

```text
ГШП ФЛОТ-ТРЕКЕР

Dashboard
Треки
Задачи
Варианты судов
Kanban
Timeline
Дайджест недели
```

Куратор:

```text
Настройки
Справочники
Аудит
```

Руководитель:

```text
Dashboard
Дайджест недели
Треки
```

---

## 78. DESIGN

Визуальная концепция: **Apple × Linear × Corporate Control Room**

Принципы: чистый интерфейс; много воздуха; яркие, но сдержанные карточки; качественная типографика; тонкие границы; мягкие тени; минималистичные графики; microinteractions; плавные переходы.

---

## 79. UI PRINCIPLE

Каждый экран должен отвечать на вопрос:

```text
Что я вижу?
↓
Что изменилось?
↓
Что мне делать?
```

---

## 80. DASHBOARD DESIGN

Не перегружать KPI. Приоритет:

```text
1. Status
2. Changes
3. Problems
4. Manager Attention
```

Количество KPI является вторичным.

---

## 81. COMMAND PALETTE

Добавить после базового MVP: `Ctrl + K`

Действия:

```text
Найти Track
Создать Task
Создать WeeklyUpdate
Перейти к Dashboard
Перейти к Digest
```

---

## 82. EMPTY STATES

Каждый список должен иметь понятный empty state. Например:

```text
У этого трека пока нет задач.

+ Добавить задачу
```

---

## 83. LOADING

Использовать skeleton. Не блокировать весь интерфейс во время обычных запросов.

---

## 84. ERROR HANDLING

Ошибки должны быть понятными пользователю. Например:

```text
Не удалось сохранить изменения.
Данные не потеряны.
Попробуйте ещё раз.
```

---

## 85. RESPONSIVE

Приоритет: Desktop → Laptop → Tablet. Mobile вторичен.

---

## 86. КОМАНДНАЯ РАБОТА: ДВА УРОВНЯ (уточнение к разделу 43)

Важно не смешивать два разных понятия совместной работы.

**Уровень 1 — совместная работа с бизнес-данными.** Это входит в продукт с ранней стадии (Phase 3), реализуется без CRDT:

```text
User A → Task
User B → Comment
User C → WeeklyUpdate
Manager → Dashboard
```

**Уровень 2 — одновременное редактирование одного rich-документа/canvas.** Это требует realtime/CRDT (Yjs/BlockSuite) и относится к отдельной, более поздней фазе (Phase 6):

```text
User A ─┐
User B ─┼→ один документ
User C ─┘
```

Формулировка `Realtime collaboration вообще не входит в MVP` неточна. Правильнее: командная работа входит в продукт с ранней стадии; realtime-совместное редактирование одного документа относится к отдельной фазе.

---

## 87. PHASE 0 — DISCOVERY / VALIDATION

Проверить: Excel; бизнес-сущности; пользователей; владельцев; права; смысл «Срок»; WeeklyUpdate; WeeklyDigest.

Ничего не программировать на основе неподтвержденной бизнес-гипотезы.

---

## 88. PHASE 1 — FOUNDATION + DATA CORE

Цель: перенести существующий рабочий процесс из Excel в нормальную систему.

Реализовать:

```text
Infrastructure
Authentication
Users
Roles

Segments
Statuses
Attractiveness

Track
Task
VesselOption

Table
Filters
Sorting

Audit

Excel Import
```

Phase 1 НЕ включает: WeeklyUpdate, WeeklyDigest, Kanban, Timeline, AI, Canvas, Realtime, PPTX.

**Acceptance:**

```text
User Login
↓
видит реальные данные
↓
открывает Track
↓
создает Task
↓
назначает deadline
↓
меняет status
↓
создает VesselOption
↓
изменения появляются в Audit
```

---

## 89. PHASE 2 — WEEKLY MANAGEMENT CORE

Это главное ядро MVP.

Реализовать:

```text
WeeklyUpdate
Dashboard
WeeklyDigest
Weekly Diff
No Update signals
Manager Help signals
Weekly History
```

**Acceptance:**

```text
Ответственный
↓
обновляет данные
↓
заполняет WeeklyUpdate
↓
Submit
```

```text
Руководитель
↓
Dashboard
↓
выбирает неделю
↓
WeeklyDigest
↓
видит изменения
↓
переходит в Track
↓
видит первичные данные
```

**После Phase 2: MVP ГОТОВ.**

---

## 90. PHASE 3 — TEAM WORKSPACE (входит в основной продукт, не блокирует MVP)

Добавить:

```text
Kanban (View поверх той же модели данных)
Совместная работа с бизнес-данными (Уровень 1, см. раздел 86)
Comments
Notifications
Track Page
Timeline
```

Эти функции улучшают ежедневную командную работу и входят в основной продукт с ранней стадии, но не требуются для доказательства основной ценности MVP (Phase 0–2) и не блокируют его завершение.

---

## 91. PHASE 4 — EXPORT + REPORTING

```text
CSV
XLSX
PDF
```

---

## 92. PHASE 5 — PPTX + ADVANCED REPORTING

PPTX строится из единого `ReportData`, а не отдельной бизнес-логики:

```text
WeeklyDigest
↓
ReportData
↓
PPTX Renderer
↓
PowerPoint
```

---

## 93. PHASE 6 — DOCUMENTS + CANVAS + REALTIME COLLABORATION

Добавить:

```text
Advanced History (Time Travel, Change Engine, Historical State, Advanced Diff)
Document Management
Rich Editor
Canvas
Realtime Collaboration (Уровень 2, см. раздел 86)
Yjs
BlockSuite
```

**Canvas — важное уточнение.** Canvas не должен быть декоративной картой. Если он реализуется, он должен стать полноценным View над Track/Task/VesselOption — карточка на Canvas ссылается на `Track.id`, а не хранит собственную копию бизнес-данных (статус, привлекательность и т.д.):

```text
Canvas
│
├── Segment
│    ├── Track A  →  ссылка на Track.id = 123
│    ├── Track B
│    └── Track C
│
├── VesselOption
│
└── Task
```

---

## 94. PHASE 7 — AI

Добавить:

```text
AI Gateway
Context Engine
Evidence
Manager AI Assistant
Document Analysis
Weekly Summary
Trend Analysis
```

---

## 95. PHASE 8 — CORPORATE PRODUCTION

Добавить:

```text
SSO
AD/LDAP
Corporate Storage
Backup
Monitoring
Security
Audit
Disaster Recovery
Production Deployment
```

---

## 96. ГРАНИЦА MVP

MVP = PHASE 0 + PHASE 1 + PHASE 2:

```text
Excel
↓
Structured Data
↓
Track / Task / VesselOption
↓
WeeklyUpdate
↓
Dashboard
↓
WeeklyDigest
↓
Manager
```

Kanban и командная работа с бизнес-данными (Phase 3) входят в основной продукт сразу после MVP и не блокируют его завершение.

---

## 97. ЧТО СОЗНАТЕЛЬНО НЕ ВХОДИТ В MVP (Phase 0–2)

```text
AI
Canvas
Realtime Collaboration (Уровень 2 — одновременное редактирование документа)
AFFiNE Editor
Full Document Management
RAG
Vector Database
OpenSearch
Time Travel UI
Event Sourcing
Complex Approval Engine
SSO
AD/LDAP
PPTX
Kanban (входит в Phase 3, сразу после MVP)
```

---

## 98. DEFINITION OF DONE

Каждая функция считается готовой только если есть:

```text
UI
API
Database
Permissions
Validation
Error handling
Loading state
Empty state
Tests
```

Для критических операций дополнительно: `Audit`.

---

## 99. E2E TEST 1

```text
Login
↓
Track
↓
Create Task
↓
Set Deadline
↓
Change Status
↓
Create VesselOption
↓
WeeklyUpdate
↓
Submit
↓
Dashboard
↓
WeeklyDigest
↓
Open Track
```

Все действия должны работать на реальных данных.

---

## 100. E2E TEST 2 — Ownership

```text
User A
создает Track

User B
видит Track

User B
пытается изменить Track

→ ACCESS DENIED
```

---

## 101. E2E TEST 3 — Audit

```text
Task
В работе
↓
Завершено
```

Audit: `actor`, `timestamp`, `field`, `before`, `after`.

---

## 102. E2E TEST 4 — Weekly Diff

```text
Week 35
Status = В работе

Week 36
Status = На стопе
```

Digest: `В работе → На стопе`

---

## 103. E2E TEST 5 — No Update

```text
Последний SUBMITTED WeeklyUpdate
Week 33
```

Текущая: `Week 35`

Dashboard: `Нет обновления 2+ недели`

---

## 104. POKE HOLES: ЗАПРЕТЫ

Claude Code запрещается:

1. Придумывать бизнес-правила.
2. Придумывать новые статусы.
3. Придумывать новые сегменты.
4. Изменять смысл существующих полей.
5. Превращать VesselOption в Task.
6. Превращать WeeklyUpdate в Comment.
7. Использовать `updatedAt` для определения deadline week.
8. Делать AI обязательным для WeeklyDigest.
9. Делать Canvas источником истины.
10. Делать AFFiNE источником бизнес-данных.
11. Использовать localStorage как БД.
12. Использовать mock data вместо реальных данных.
13. Делать hard delete рабочих сущностей.
14. Передавать корпоративные данные внешнему AI без разрешения.
15. Позволять AI самостоятельно менять данные.
16. Создавать microservices без необходимости.
17. Делать hard-coded users.
18. Делать hard-coded statuses.
19. Делать hard-coded segments.
20. Оставлять TODO вместо обязательной MVP-функции.

---

## 105. ОСОБОЕ ПРАВИЛО CLAUDE CODE

Если обнаружено неизвестное бизнес-правило:

```text
НЕ УГАДЫВАТЬ.
```

Создать:

```text
UNRESOLVED BUSINESS RULE
```

с указанием:

```text
Что неизвестно
Почему важно
Вариант A
Вариант B
Что требуется подтвердить
```

---

## 106. PRINCIPLE OF CHANGE

Перед изменением существующего кода Claude должен:

```text
1. Найти существующую реализацию.
2. Понять зависимость.
3. Проверить DB.
4. Проверить API.
5. Проверить permissions.
6. Проверить tests.
7. Только после этого изменять.
```

Не переписывать работающий код без необходимости.

---

## 107. КЛЮЧЕВАЯ АРХИТЕКТУРНАЯ ИДЕЯ

Все представления работают с одной моделью:

```text
                 DATA MODEL
                     │
       ┌─────────────┼─────────────┐
       ↓             ↓             ↓
     TABLE         KANBAN       TIMELINE
       │             │             │
       └─────────────┼─────────────┘
                     ↓
                DASHBOARD
                     ↓
               WEEKLY DIGEST
```

Никаких отдельных данных для Kanban, Dashboard или Digest.

---

## 108. ФИНАЛЬНАЯ АРХИТЕКТУРА

```text
                         ГШП
                          │
                  ФЛОТ-ТРЕКЕР
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
       DATA             WORK              REPORT
        │                 │                 │
     Track              Task          WeeklyDigest
     VesselOption       WeeklyUpdate   Dashboard
     User               Comments       Export
        │
        ↓
     PostgreSQL
        │
        ↓
     Audit Log
```

Будущий слой:

```text
PostgreSQL
    ↓
Document Layer
    ↓
BlockSuite / Yjs
    ↓
Rich Editor / Canvas / Collaboration
```

И позднее:

```text
Context Engine
      ↓
AI Gateway
      ↓
Local / Corporate AI
      ↓
Manager Assistant
```

---

## 109. ФИНАЛЬНАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ ФАЗ

```text
PHASE 0
Validation
        ↓
PHASE 1
Foundation + Data Core
        ↓
PHASE 2
Weekly Management Core
        ↓
        MVP
        ↓
PHASE 3
Team Workspace
(Kanban, командная работа с данными, Comments, Notifications)
        ↓
PHASE 4
Export + Reporting (CSV/XLSX/PDF)
        ↓
PHASE 5
PPTX + Advanced Reporting
        ↓
PHASE 6
Advanced History + Canvas + Realtime Collaborative Editor
(BlockSuite / Yjs)
        ↓
PHASE 7
AI
        ↓
PHASE 8
Corporate Production
```

---

## 110. ГЛАВНЫЙ ACCEPTANCE CRITERION

Система считается успешно реализованной, если вместо процесса:

```text
15 сотрудников
↓
разрозненные данные
↓
Excel
↓
ручной сбор
↓
ручная презентация
```

работает:

```text
15 сотрудников
↓
единая система
↓
структурированные Track / Task / VesselOption
↓
WeeklyUpdate
↓
автоматический Digest
↓
руководитель
```

И руководитель может за несколько минут получить ответы на пять вопросов:

```text
1. Что происходит?
2. Что изменилось?
3. Что остановилось?
4. Где нет движения?
5. Где требуется мое внимание?
```

---

## 111. ФИНАЛЬНАЯ ИНСТРУКЦИЯ CLAUDE CODE

```text
Разрабатывай ГШП Флот-Трекер строго по данному ТЗ.

Не расширяй scope самостоятельно.

Главный результат MVP:
структурированные рабочие данные
+
еженедельные обновления
+
автоматический управленческий дайджест.

MVP заканчивается после PHASE 2.

PHASE 0: Discovery / Validation.
PHASE 1: Foundation + Data Core.
PHASE 2: Weekly Management Core.

После PHASE 2 продукт считается MVP.

PHASE 3 (Team Workspace: Kanban, командная работа с данными,
Comments, Notifications) входит в основной продукт сразу после MVP
и не блокирует его завершение — но и не начинается раньше PHASE 2.

PHASE 4+ (Export/PPTX/Canvas/Realtime/AI/Corporate Production)
развивают продукт дальше и тем более не блокируют MVP.

Не начинай с AI.
Не начинай с Canvas.
Не начинай с realtime collaboration.
Не начинай с AFFiNE editor.
Не начинай с Kanban раньше Weekly Management Core.

Сначала реализуй бизнес-ядро.

Используй PostgreSQL как единственный source of truth.
Используй Audit Log с первого дня.
Не используй Event Sourcing в MVP.
Не используй localStorage как database.

WeeklyDigest должен работать без AI.
Все KPI должны рассчитываться детерминированно.

VesselOption является отдельной сущностью.
WeeklyUpdate является отдельной сущностью.
WeeklyDigest является отдельной сущностью.
Track является основной управленческой сущностью.

Deadline Week рассчитывается от deadline.
Не использовать updatedAt для определения недели задачи.

Не придумывать бизнес-логику.
Если бизнес-правило не определено: UNRESOLVED BUSINESS RULE.

Не изменять исходные справочники без подтверждения.
Не использовать mock production data.

Каждая обязательная функция должна иметь:
UI, API, DB, permissions, validation, loading, empty, error, tests.

Перед крупным изменением сначала анализировать существующий код.
Не переписывать работающий код без необходимости.

AFFiNE/BlockSuite использовать только как технологический источник
для будущего document/editor/collaboration слоя (Phase 6).
Не делать branded fork AFFiNE.

Notion использовать только как источник UX-концепций:
views, filters, sorting, grouping, linked views, history, backlinks.

Бизнес-модель ГШП должна оставаться собственной.

Kanban — это View поверх единой модели данных, не отдельная БД.
Canvas, если реализуется, — это View поверх Track/Task/VesselOption
со ссылками на их id, а не источник истины.

Командная работа с бизнес-данными (комментарии, параллельная работа
разных людей с разными Task/Track/WeeklyUpdate) входит в продукт
с ранней стадии (Phase 3). Realtime-совместное редактирование
одного rich-документа/Canvas — отдельная, более поздняя фаза (Phase 6).

Главный критерий:
Система должна уменьшить ручной труд по сбору еженедельной
информации и подготовке управленческой отчетности.
```
