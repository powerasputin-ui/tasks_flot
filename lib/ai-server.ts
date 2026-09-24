import { prisma } from "@/lib/prisma";
import { canViewVersion } from "@/lib/memo-versions";
import { listDirectorates } from "@/lib/directorates";
import { parseMemoDoc } from "@/lib/memo";
import { effectiveDate, type VersionSource } from "@/lib/memo-archive";
import { AiError, decryptKey, type AiConfig, type AiProvider, type MemoForAi } from "@/lib/ai";
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
