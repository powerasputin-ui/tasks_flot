import { prisma } from "@/lib/prisma";

/** Дирекции меняются редко: держим список в памяти минуту (сбрасывается при любом изменении). */
export type DirectorateInfo = { id: string; name: string; isActive: boolean };

const TTL_MS = 60_000;
let cache: { at: number; list: DirectorateInfo[] } | null = null;

export async function listDirectorates(): Promise<DirectorateInfo[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.list;
  const list = await prisma.directorate.findMany({ select: { id: true, name: true, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  cache = { at: Date.now(), list };
  return list;
}

export function invalidateDirectorates(): void {
  cache = null;
}

export async function directorateName(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  return (await listDirectorates()).find((d) => d.id === id)?.name ?? null;
}

/** Имя куки, в которой админ запоминает выбранную для работы дирекцию. */
export const DIRECTORATE_COOKIE = "dir";

/** Кука режима «Посмотреть как»: идентификатор человека, глазами которого смотрит админ или директор. */
export const VIEW_AS_COOKIE = "viewas";
