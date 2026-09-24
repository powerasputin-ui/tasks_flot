import { z } from "zod";

/**
 * Конфигурация отчёта (что показывать в «Оперативке» и в выгрузках). Шаблон отчёта — это просто сохранённая конфигурация.
 * Один и тот же конфиг строит и экран, и файлы Excel/PDF/PowerPoint (см. lib/report.ts).
 */
export const STD_COLUMNS = ["segment", "track", "name", "cost", "attractiveness", "owner", "deadline", "status", "operFlag", "comment"] as const;
export type StdColumn = (typeof STD_COLUMNS)[number];

export const COLUMN_LABEL: Record<StdColumn, string> = {
  segment: "Сегмент",
  track: "Трек",
  name: "Задача",
  cost: "Оценка $",
  attractiveness: "Привлекательность",
  owner: "Ответственный",
  deadline: "Дедлайн",
  status: "Статус",
  operFlag: "Оперативка",
  comment: "Комментарий",
};

export const GROUP_KEYS = ["segment", "track", "owner", "status"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];
export const GROUP_LABEL: Record<GroupKey, string> = { segment: "Сегмент", track: "Трек", owner: "Ответственный", status: "Статус" };

export const SORT_KEYS = ["deadline", "name", "status", "owner", "updatedAt"] as const;
/** Устаревшая настройка: комментарий теперь обычная колонка. Оставлена, чтобы старые сохранённые шаблоны проходили проверку. */
export const COMMENT_MODES = ["column", "underTask", "hide"] as const;
export const COMMENT_MODE_LABEL: Record<(typeof COMMENT_MODES)[number], string> = {
  column: "Отдельной колонкой",
  underTask: "Строкой под задачей",
  hide: "Не показывать",
};

const idList = z.array(z.string().min(1)).max(200).optional();

export const reportConfigSchema = z.object({
  title: z.string().trim().max(120).optional(),
  /** Колонки по порядку: стандартные и свои (custom:<id>). */
  columns: z.array(z.string().min(1).max(80)).min(1).max(30),
  /** Уровни группировки сверху вниз; пусто — плоский список. */
  groupBy: z.array(z.enum(GROUP_KEYS)).max(3),
  filters: z
    .object({
      segmentIds: idList,
      trackIds: idList,
      statusIds: idList,
      ownerIds: idList,
      attractivenessIds: idList,
      sentOnly: z.boolean().optional(),
      overdueOnly: z.boolean().optional(),
    })
    .optional(),
  sort: z.object({ by: z.enum(SORT_KEYS), dir: z.enum(["asc", "desc"]) }).optional(),
  options: z.object({ summary: z.boolean().optional(), comments: z.enum(COMMENT_MODES).optional() }).optional(),
  /** Задел под «дирекции» (выбор дирекции при входе); пока не используется. */
  directorateId: z.string().nullable().optional(),
});

export type ReportConfig = z.infer<typeof reportConfigSchema>;

/** Конфиг с подставленными значениями по умолчанию. */
export type ResolvedReportConfig = {
  title: string | undefined;
  columns: string[];
  groupBy: GroupKey[];
  filters: NonNullable<ReportConfig["filters"]>;
  sort: { by: (typeof SORT_KEYS)[number]; dir: "asc" | "desc" };
  options: { summary: boolean };
};

export function resolveConfig(c: ReportConfig): ResolvedReportConfig {
  return {
    title: c.title,
    columns: c.columns,
    groupBy: c.groupBy,
    filters: c.filters ?? {},
    sort: c.sort ?? { by: "deadline", dir: "asc" },
    options: { summary: c.options?.summary ?? true },
  };
}

export type ReportTemplateDef = { id: string; name: string; system: true; config: ReportConfig };

/** Шаблоны «из коробки» (в базу не пишутся). */
export const SYSTEM_TEMPLATES: ReportTemplateDef[] = [
  {
    id: "sys:directorate",
    name: "Оперативка по дирекции",
    system: true,
    config: {
      columns: ["name", "owner", "status", "deadline", "comment"],
      groupBy: ["segment", "track"],
      sort: { by: "deadline", dir: "asc" },
      options: { summary: true },
    },
  },
  {
    id: "sys:table",
    name: "Как в таблице",
    system: true,
    config: {
      columns: ["segment", "track", "name", "cost", "attractiveness", "owner", "deadline", "status", "operFlag", "comment"],
      groupBy: [],
      sort: { by: "deadline", dir: "asc" },
      options: { summary: false },
    },
  },
];

export const DEFAULT_TEMPLATE_ID = "sys:directorate";

export function systemTemplate(id: string): ReportTemplateDef | undefined {
  return SYSTEM_TEMPLATES.find((t) => t.id === id);
}

/** Название дирекции по умолчанию (позже выбирается при входе; хранится в настройке directorate.name). */
export const DEFAULT_DIRECTORATE = "Дирекция по развитию флота и коммерческой эксплуатации";
