import { prisma } from "@/lib/prisma";
import { canViewVersion } from "@/lib/memo-versions";
import { listDirectorates } from "@/lib/directorates";
import { parseMemoDoc } from "@/lib/memo";
import { effectiveDate, type VersionSource } from "@/lib/memo-archive";
import { AiError, aiBudget, decryptKey, normalizeBaseUrl, providerLabel, type AiConfig, type AiProvider, type MemoForAi } from "@/lib/ai";
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
    const apiKey = decryptKey(s.apiKeyEnc);
    return { provider: s.provider as AiProvider, baseUrl: baseUrlForKey(apiKey, s.baseUrl), model: s.model, apiKey };
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

/** Ключ из переменной, даже если его вставили с лишним: «GROQ=…», в кавычках, с пробелами или переводом строки. */
export function cleanEnvKey(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/^[A-Za-z_]+\s*=\s*/, "").replace(/^["']|["']$/g, "").trim();
}

function envConfig(prefix: "AI" | "AI_FALLBACK", d: { baseUrl: string; model: string }): AiConfig | null {
  const apiKey = cleanEnvKey(process.env[`${prefix}_API_KEY`]);
  if (!apiKey) return null;
  const base = normalizeBaseUrl(process.env[`${prefix}_BASE_URL`]?.trim() || d.baseUrl, "openai");
  if (!base) return null;
  const baseUrl = baseUrlForKey(apiKey, base);
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
  const shared = sharedAiConfig();
  // личный ключ главнее, но если он не сработает — запрос уйдёт в общее подключение
  if (own) return shared ? { ...own, fallback: shared } : own;
  return shared ? { ...shared, shared: true } : null;
}

/** Ошибки, при которых есть смысл повторить у следующего в цепочке: лимит, сбой, неверный ключ одного из провайдеров. */
const RETRYABLE = new Set(["RATE_LIMIT", "PROVIDER", "NETWORK", "BAD_ANSWER", "BAD_KEY"]);

type Chain = AiConfig & { fallback?: Chain };

/**
 * Запрос к ИИ по цепочке: личный ключ → общий основной → общий запасной. Если справки не влезают в окно звена
 * (у бесплатного Groq — ~11 тыс. символов), а дальше есть звено шире — сразу идём к нему, чтобы ответ был по справкам целиком.
 * Если не сработали все — показываем ошибку первого звена (обычно самую понятную).
 */
export async function withAiFallback<T>(cfg: Chain, contextLength: number, run: (c: AiConfig) => Promise<T>, preroute = true): Promise<T> {
  const fb = cfg.fallback;
  // «Авто»: справки не влезают в окно этого звена — сразу к звену шире. При явном выборе модели так не делаем.
  if (preroute && fb && contextLength > aiBudget(cfg).contextChars && maxWindow(fb) > aiBudget(cfg).contextChars) return withAiFallback(fb, contextLength, run, preroute);
  try {
    return await run(cfg);
  } catch (e) {
    if (!fb || !(e instanceof AiError) || !RETRYABLE.has(e.code)) throw e;
    console.warn(`[ai] ${providerLabel(cfg.baseUrl)} ${cfg.model}: ${e.code} — пробуем ${providerLabel(fb.baseUrl)}`);
    try {
      return await withAiFallback(fb, contextLength, run, preroute);
    } catch (next) {
      // не сработало ни одно звено — показываем причину каждого, иначе не понять, какой ключ чинить
      const rest = next instanceof AiError ? next.message : "сбой";
      throw new AiError(e.code, `${e.message} Запасной вариант тоже не сработал: ${rest}`);
    }
  }
}

/**
 * Выбор модели человеком (как переключатель модели в чате): «auto» — эвристика (Groq, большие справки и сбои — NVIDIA);
 * «primary» / «fallback» — сначала выбранная модель общего подключения, вторая — только если выбранная не ответила.
 * С личным ключом выбора нет: работает его модель.
 */
export type AiEngine = "auto" | "primary" | "fallback";
/** Локальная модель в браузере: сервер не зовёт облако, а отдаёт готовый запрос (см. lib/local-ai.ts). */
export const isLocalEngine = (v: unknown) => v === "local";
export function parseEngine(v: unknown): AiEngine {
  return v === "primary" || v === "fallback" ? v : "auto";
}
export function chainForEngine(cfg: Chain & { shared?: boolean }, engine: AiEngine): { chain: Chain; preroute: boolean } {
  if (!cfg.shared || engine === "auto") return { chain: cfg, preroute: true };
  const { fallback, ...primary } = cfg;
  if (engine === "fallback" && fallback) return { chain: { ...fallback, fallback: primary }, preroute: false };
  return { chain: cfg, preroute: false };
}

/** Подпись модели для человека: «Groq · openai/gpt-oss-120b». */
export function modelLabel(c: Pick<AiConfig, "baseUrl" | "model">): string {
  return `${providerLabel(c.baseUrl)} · ${c.model}`;
}

function maxWindow(c: Chain): number {
  return Math.max(aiBudget(c).contextChars, c.fallback ? maxWindow(c.fallback) : 0);
}

/**
 * Ключ сам говорит, чей он: gsk_ — Groq, nvapi- — NVIDIA. Если адрес оставили пустым (по умолчанию OpenAI) или указали
 * не тот, а ключ явно чужой — берём адрес провайдера ключа: иначе запрос гарантированно отклонят.
 */
/**
 * Ключи провайдеров — длинная строка без пробелов (gsk_…, nvapi-…, sk-…: от 20 символов). Короткое значение — почти всегда
 * сохранённый пароль от сайта, который браузер сам подставил в поле ключа; к провайдеру такое не отправляем.
 */
export const NOT_A_KEY_MESSAGE = "Это не похоже на ключ API — возможно, браузер сам подставил сохранённый пароль. Очистите поле «Ключ API» или закройте «свой ключ»: общее подключение работает без него.";
export function looksLikeApiKey(key: string): boolean {
  return key.length >= 20 && !/\s/.test(key);
}

export function baseUrlForKey(apiKey: string, baseUrl: string): string {
  const host = (() => {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      return "";
    }
  })();
  if (apiKey.startsWith("gsk_") && !host.includes("groq")) return "https://api.groq.com/openai/v1";
  if (apiKey.startsWith("nvapi-") && !host.includes("nvidia")) return "https://integrate.api.nvidia.com/v1";
  return baseUrl;
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
