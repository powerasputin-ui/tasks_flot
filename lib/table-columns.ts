// Настройки колонок таблицы: общие для таблицы и страницы «Настройки → Колонки таблицы».

export type StdKey = "track" | "cost" | "attractiveness" | "name" | "deadline" | "deadlineWeek" | "owner" | "status" | "operFlag" | "memo" | "comment";
/** Свои колонки куратора имеют ключ custom:<id колонки>. */
export type ColumnKey = StdKey | `custom:${string}`;

/** width — не пиксели, а относительный вес: колонки растягиваются на 100% пропорционально. */
/** removed — колонка «удалена» из таблицы этим пользователем (её можно вернуть в настройках). */
export type ColumnConfig = { key: ColumnKey; label: string; visible: boolean; width: number; removed?: boolean };

export const DEFAULT_LABEL: Record<StdKey, string> = {
  track: "Трек",
  cost: "Оценка $",
  attractiveness: "Привлекательность",
  name: "Задача",
  deadline: "Дедлайн",
  deadlineWeek: "Неделя",
  owner: "Ответственный",
  status: "Статус",
  operFlag: "Опер",
  memo: "В справку",
  comment: "Комментарии",
};

export const ALL_KEYS: StdKey[] = ["track", "name", "cost", "attractiveness", "owner", "deadline", "status", "operFlag", "memo", "comment", "deadlineWeek"];

export const WIDTH: Record<StdKey, number> = {
  track: 170,
  cost: 110,
  attractiveness: 130,
  name: 280,
  deadline: 110,
  deadlineWeek: 80,
  owner: 160,
  status: 130,
  operFlag: 70,
  memo: 90,
  comment: 240,
};

export const DEFAULT_VISIBLE: StdKey[] = ["track", "name", "cost", "attractiveness", "owner", "deadline", "status", "operFlag", "memo", "comment"];

export function buildColumns(visibleKeys: StdKey[]): ColumnConfig[] {
  const ordered = [...visibleKeys, ...ALL_KEYS.filter((k) => !visibleKeys.includes(k))];
  return ordered.map((key) => ({ key, label: DEFAULT_LABEL[key], visible: visibleKeys.includes(key), width: WIDTH[key] }));
}

export const DEFAULT_COLUMNS = buildColumns(DEFAULT_VISIBLE);
// v2: сброшен набор колонок первой версии.
export const STORAGE_KEY = "operativka.tableColumns.v2";

/** Приводит сохранённые настройки к актуальному набору колонок (переименования, новые колонки). */
export function normalizeColumns(saved: ColumnConfig[]): ColumnConfig[] {
  const parsed = saved.filter((c) => ALL_KEYS.includes(c.key as StdKey) || c.key.startsWith("custom:"));
  // Старые стандартные подписи (до переименования) заменяем новыми; свои названия не трогаем.
  const RENAMED: Record<string, string> = { "Название": "Задача", "Срок": "Дедлайн" };
  for (const c of parsed) if (RENAMED[c.label]) c.label = RENAMED[c.label];
  const known = new Set<string>(parsed.map((c) => c.key));
  return [...parsed, ...DEFAULT_COLUMNS.filter((c) => !known.has(c.key))];
}

/** Настройки, оставшиеся в этом браузере от прежней версии (переносятся в учётную запись один раз). */
export function loadLocalColumns(): ColumnConfig[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ColumnConfig[]) : null;
  } catch {
    return null;
  }
}

export type CustomCol = { id: string; name: string; type: "TEXT" | "NUMBER" | "DATE" | "SELECT"; options: string[] };

/** Добавляет свои колонки к настройкам таблицы и убирает удалённые; подписи берутся из справочника. */
export function withCustomColumns(cols: ColumnConfig[], custom: CustomCol[]): ColumnConfig[] {
  const byKey = new Map(custom.map((c) => [`custom:${c.id}`, c]));
  const kept = cols
    .filter((c) => !c.key.startsWith("custom:") || byKey.has(c.key))
    .map((c) => (byKey.has(c.key) ? { ...c, label: byKey.get(c.key)!.name } : c));
  const known = new Set<string>(kept.map((c) => c.key));
  const added = custom
    .filter((c) => !known.has(`custom:${c.id}`))
    .map((c): ColumnConfig => ({ key: `custom:${c.id}`, label: c.name, visible: true, width: 140 }));
  return [...kept, ...added];
}

