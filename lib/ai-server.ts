import { prisma } from "@/lib/prisma";
import { canViewVersion } from "@/lib/memo-versions";
import { listDirectorates } from "@/lib/directorates";
import { parseMemoDoc } from "@/lib/memo";
import { effectiveDate, type VersionSource } from "@/lib/memo-archive";
import { AiError, aiBudget, decryptKey, normalizeBaseUrl, type AiConfig, type AiProvider, type MemoForAi } from "@/lib/ai";
import type { Actor } from "@/lib/permissions";

export const MAX_VERSIONS = 12;

export function isExecutive(actor: { role: string }): boolean {
  return actor.role === "EXECUTIVE";
}

/** ИИ-помощником (подключение и чат по справкам) пользуются ЗГД и админ; сводка из нескольких дирекций — только ЗГД. */
export function canUseAi(actor: { role: string }): boolean {
  return actor.role === "EXECUTIVE" || actor.role === "ADMIN";
}

export async function loadAiConfig(userId: string): Promise<AiConfig | null> {
  const s = await prisma.aiSetting.findUnique({ where: { userId } });
  if (!s) return null;
  try {
    return { provider: s.provider as AiProvider, baseUrl: s.baseUrl, model: s.model, apiKey: decryptKey(s.apiKeyEnc) };
  } catch {
    throw new AiError("NOT_CONFIGURED", "Сохранённый ключ не удалось прочитать — введите его заново в настройках ИИ.");
  }
}

/**
 * Общее подключение ИИ для всей организации — из переменных окружения сервера (в Vercel, тип Sensitive).
 * Пользователи ключей не видят и не вставляют: чат работает сразу. Личный ключ в настройках, если задан, главнее.
 *   AI_API_KEY (+ AI_BASE_URL, AI_MODEL) — основной провайдер, по умолчанию Groq · GPT-OSS 120B;
 *   AI_FALLBACK_API_KEY (+ AI_FALLBACK_BASE_URL, AI_FALLBACK_MODEL) — запасной, по умолчанию NVIDIA · Nemotron 3 Super:
 *   на него уходит запрос, если основной упёрся в лимит или недоступен, и сразу — если справки не влезают в окно основного.
 */
export const SHARED_DEFAULTS = {
  primary: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  fallback: { baseUrl: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-3-super-120b-a12b" },
};

function envConfig(prefix: "AI" | "AI_FALLBACK", d: { baseUrl: string; model: string }): AiConfig | null {
  const apiKey = process.env[`${prefix}_API_KEY`]?.trim();
  if (!apiKey) return null;
  const baseUrl = normalizeBaseUrl(process.env[`${prefix}_BASE_URL`]?.trim() || d.baseUrl, "openai");
  if (!baseUrl) return null;
  return { provider: "openai", baseUrl, model: process.env[`${prefix}_MODEL`]?.trim() || d.model, apiKey };
}

export function sharedAiConfig(): (AiConfig & { fallback?: AiConfig }) | null {
  const primary = envConfig("AI", SHARED_DEFAULTS.primary);
  const fallback = envConfig("AI_FALLBACK", SHARED_DEFAULTS.fallback);
  if (!primary) return fallback;
  return fallback ? { ...primary, fallback } : primary;
}

/** Что использовать: личный ключ человека, иначе общее подключение организации. */
export async function loadEffectiveAiConfig(userId: string): Promise<(AiConfig & { fallback?: AiConfig; shared?: boolean }) | null> {
  const own = await loadAiConfig(userId);
  if (own) return own;
  const shared = sharedAiConfig();
  return shared ? { ...shared, shared: true } : null;
}

/** Ошибки, при которых есть смысл повторить у запасного провайдера (не «нет прав» и не «плохой запрос»). */
const RETRYABLE = new Set(["RATE_LIMIT", "PROVIDER", "NETWORK", "BAD_ANSWER"]);

/**
 * Запрос к ИИ с запасным провайдером. Если справки не влезают в окно основного (у бесплатного Groq — ~11 тыс. символов),
 * а запасной шире — сразу идём к запасному, чтобы ответ был по справкам целиком.
 */
export async function withAiFallback<T>(cfg: AiConfig & { fallback?: AiConfig }, contextLength: number, run: (c: AiConfig) => Promise<T>): Promise<T> {
  const fb = cfg.fallback;
  if (fb && contextLength > aiBudget(cfg).contextChars && aiBudget(fb).contextChars > aiBudget(cfg).contextChars) return run(fb);
  try {
    return await run(cfg);
  } catch (e) {
    if (fb && e instanceof AiError && RETRYABLE.has(e.code)) return run(fb);
    throw e;
  }
}

/** Версии справок по id: только те, которые этому человеку разрешено видеть (чужие и несуществующие молча отбрасываются). */
export async function loadMemosForAi(actor: Actor, ids: unknown): Promise<MemoForAi[]> {
  const list = (Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === "string").slice(0, MAX_VERSIONS);
  if (list.length === 0) return [];
  const [versions, dirs] = await Promise.all([prisma.memoVersion.findMany({ where: { id: { in: list } } }), listDirectorates()]);
  const names = new Map(dirs.map((d) => [d.id, d.name]));
  return versions
    .filter((v) => canViewVersion(actor, v))
    .sort((a, b) => effectiveDate(a).getTime() - effectiveDate(b).getTime() || (names.get(a.directorateId) ?? "").localeCompare(names.get(b.directorateId) ?? "", "ru"))
    .map((v) => ({
      id: v.id,
      directorate: names.get(v.directorateId) ?? "Дирекция",
      title: v.title,
      date: effectiveDate(v).toLocaleDateString("ru-RU"),
      revision: v.revision,
      doc: parseMemoDoc(v.doc) ?? { sections: [] },
      sources: (Array.isArray(v.sources) ? v.sources : []) as unknown as VersionSource[],
    }));
}

/** Ошибка ИИ → понятный ответ API. */
export function aiErrorResponse(e: unknown): Response {
  if (e instanceof AiError) {
    const status = e.code === "NOT_CONFIGURED" ? 409 : e.code === "BAD_KEY" ? 401 : e.code === "RATE_LIMIT" ? 429 : 502;
    return Response.json({ error: e.code, message: e.message }, { status });
  }
  return Response.json({ error: "PROVIDER", message: "Не удалось получить ответ ИИ." }, { status: 502 });
}

/** Последняя отправленная справка каждой доступной дирекции — контекст чата, когда конкретная справка не открыта. */
export async function loadLatestMemoIds(actor: Actor): Promise<string[]> {
  const versions = await prisma.memoVersion.findMany({ orderBy: { sentAt: "desc" }, select: { id: true, directorateId: true } });
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const v of versions) {
    if (seen.has(v.directorateId) || !canViewVersion(actor, v)) continue;
    seen.add(v.directorateId);
    ids.push(v.id);
    if (ids.length >= MAX_VERSIONS) break;
  }
  return ids;
}
