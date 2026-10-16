import { prisma } from "@/lib/prisma";
import { canPostInChat, canStartChat, chatBlockReason, CHAT_MAX_TEXT, CHAT_RETENTION_DAYS, pairOf, type ChatPerson } from "@/lib/chat-rules";

/** Личный чат 1 на 1: запросы к базе. Права — lib/chat-rules.ts (те же функции проверяют каждое сообщение). */
export type ChatResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; message: string };
const fail = (status: number, message: string): { ok: false; status: number; error: string; message: string } => ({ ok: false, status, error: status === 404 ? "NOT_FOUND" : status === 403 ? "FORBIDDEN" : "INVALID_INPUT", message });

type PersonRow = ChatPerson & { name: string; directorateName: string | null };

async function loadPeople(ids: string[]): Promise<Map<string, PersonRow>> {
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true, isActive: true, directorateId: true, directorate: { select: { name: true, shortName: true } } } });
  return new Map(users.map((u) => [u.id, { id: u.id, name: u.name, role: u.role, isActive: u.isActive, directorateId: u.directorateId, directorateName: u.directorate ? u.directorate.shortName ?? u.directorate.name : null }]));
}

export type ChatPersonView = { id: string; name: string; role: string; directorateName: string | null };
const view = (p: PersonRow): ChatPersonView => ({ id: p.id, name: p.name, role: p.role, directorateName: p.directorateName });

/** Кому actor может написать первым (список выбора «Новый диалог»). */
export async function chatPeople(actorId: string): Promise<ChatPersonView[]> {
  const me = (await loadPeople([actorId])).get(actorId);
  if (!me || me.isActive === false) return [];
  const users = await prisma.user.findMany({ where: { isActive: true, id: { not: actorId }, role: { in: ["HEAD", "DIRECTOR", "ADMIN", "EXECUTIVE"] } }, select: { id: true }, take: 500 });
  const people = await loadPeople(users.map((u) => u.id));
  return [...people.values()].filter((p) => canStartChat(me, p)).sort((a, b) => a.name.localeCompare(b.name, "ru")).map(view);
}

export type ChatThreadView = { id: string; other: ChatPersonView; lastText: string | null; lastAt: string; lastMine: boolean; unread: number; canPost: boolean };

export async function listThreads(actorId: string): Promise<{ threads: ChatThreadView[]; unreadTotal: number }> {
  const threads = await prisma.chatThread.findMany({ where: { OR: [{ userAId: actorId }, { userBId: actorId }] }, orderBy: { lastMessageAt: "desc" }, take: 50 });
  if (threads.length === 0) return { threads: [], unreadTotal: 0 };
  const ids = threads.map((t) => t.id);
  const otherIds = threads.map((t) => (t.userAId === actorId ? t.userBId : t.userAId));
  const [people, lasts, unreads] = await Promise.all([
    loadPeople([actorId, ...otherIds]),
    prisma.$queryRaw<Array<{ threadId: string; text: string; authorId: string }>>`SELECT DISTINCT ON ("threadId") "threadId", "text", "authorId" FROM chat_messages WHERE "threadId" = ANY(${ids}) ORDER BY "threadId", "createdAt" DESC`,
    prisma.$queryRaw<Array<{ threadId: string; c: number }>>`SELECT m."threadId", COUNT(*)::int AS c FROM chat_messages m LEFT JOIN chat_reads r ON r."threadId" = m."threadId" AND r."userId" = ${actorId} WHERE m."threadId" = ANY(${ids}) AND m."authorId" <> ${actorId} AND m."createdAt" > COALESCE(r."lastReadAt", 'epoch'::timestamp) GROUP BY m."threadId"`,
  ]);
  const me = people.get(actorId);
  const lastBy = new Map(lasts.map((l) => [l.threadId, l]));
  const unreadBy = new Map(unreads.map((u) => [u.threadId, u.c]));
  const out: ChatThreadView[] = [];
  for (const t of threads) {
    const other = people.get(t.userAId === actorId ? t.userBId : t.userAId);
    if (!other || !me) continue;
    const last = lastBy.get(t.id);
    out.push({ id: t.id, other: view(other), lastText: last?.text.slice(0, 120) ?? null, lastAt: t.lastMessageAt.toISOString(), lastMine: last?.authorId === actorId, unread: unreadBy.get(t.id) ?? 0, canPost: canPostInChat(me, other, { zgdSpoke: t.zgdSpoke, closed: !!t.closedAt }) });
  }
  return { threads: out, unreadTotal: out.reduce((s, t) => s + t.unread, 0) };
}

/** Сколько непрочитанных сообщений у человека (значок на кнопке чата). */
export async function unreadTotal(actorId: string): Promise<number> {
  const r = await prisma.$queryRaw<Array<{ c: number }>>`SELECT COUNT(*)::int AS c FROM chat_messages m JOIN chat_threads t ON t.id = m."threadId" LEFT JOIN chat_reads r ON r."threadId" = t.id AND r."userId" = ${actorId} WHERE (t."userAId" = ${actorId} OR t."userBId" = ${actorId}) AND m."authorId" <> ${actorId} AND m."createdAt" > COALESCE(r."lastReadAt", 'epoch'::timestamp)`;
  return r[0]?.c ?? 0;
}

export type ChatMessageView = { id: string; authorId: string; text: string; createdAt: string; item: { id: string; title: string } | null; itemUnavailable: boolean };

/** Задача по ссылке: название видит только тот, кому она доступна (своя дирекция, админ; ЗГД — подтверждённые для него). */
async function resolveItems(viewer: PersonRow, ids: string[]): Promise<Map<string, { id: string; title: string } | null>> {
  const out = new Map<string, { id: string; title: string } | null>();
  if (ids.length === 0) return out;
  const items = await prisma.operationalItem.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, directorateId: true, publishedAt: true, archivedAt: true } });
  for (const i of items) {
    const ok = !i.archivedAt && (viewer.role === "ADMIN" || (viewer.role === "EXECUTIVE" ? !!i.publishedAt : i.directorateId === viewer.directorateId));
    out.set(i.id, ok ? { id: i.id, title: i.title } : null);
  }
  return out;
}

async function toViews(viewer: PersonRow, msgs: Array<{ id: string; authorId: string; text: string; createdAt: Date; itemId: string | null }>): Promise<ChatMessageView[]> {
  const items = await resolveItems(viewer, [...new Set(msgs.map((m) => m.itemId).filter((x): x is string => !!x))]);
  return msgs.map((m) => ({ id: m.id, authorId: m.authorId, text: m.text, createdAt: m.createdAt.toISOString(), item: m.itemId ? items.get(m.itemId) ?? null : null, itemUnavailable: !!m.itemId && !items.get(m.itemId) }));
}

export type ChatThreadDetail = { id: string; other: ChatPersonView; closed: boolean; canPost: boolean; blockReason: string | null; canClose: boolean; messages: ChatMessageView[] };

/** Диалог с сообщениями; since — только новое (клиент опрашивает), markRead — отметить прочитанным. Участник — иначе 404. */
export async function getThread(actorId: string, threadId: string, opts: { since?: Date; markRead?: boolean } = {}): Promise<ChatResult<ChatThreadDetail>> {
  const t = await prisma.chatThread.findUnique({ where: { id: threadId } });
  if (!t || (t.userAId !== actorId && t.userBId !== actorId)) return fail(404, "Диалог не найден.");
  const otherId = t.userAId === actorId ? t.userBId : t.userAId;
  const people = await loadPeople([actorId, otherId]);
  const me = people.get(actorId);
  const other = people.get(otherId);
  if (!me || !other) return fail(404, "Диалог не найден.");
  const rows = opts.since
    ? await prisma.chatMessage.findMany({ where: { threadId, createdAt: { gte: opts.since } }, orderBy: { createdAt: "asc" }, take: 200 })
    : (await prisma.chatMessage.findMany({ where: { threadId }, orderBy: { createdAt: "desc" }, take: 100 })).reverse();
  if (opts.markRead) await prisma.chatRead.upsert({ where: { threadId_userId: { threadId, userId: actorId } }, create: { threadId, userId: actorId }, update: { lastReadAt: new Date() } });
  const state = { zgdSpoke: t.zgdSpoke, closed: !!t.closedAt };
  return { ok: true, data: { id: t.id, other: view(other), closed: state.closed, canPost: canPostInChat(me, other, state), blockReason: chatBlockReason(me, other, state), canClose: me.role === "EXECUTIVE" && !state.closed, messages: await toViews(me, rows) } };
}

/** Написать человеку: диалог создаётся при первом сообщении (по паре людей), права — chat-rules. */
export async function sendMessage(actorId: string, input: { toUserId: string; text: string; itemId?: string | null }): Promise<ChatResult<{ threadId: string; message: ChatMessageView }>> {
  const text = input.text.trim();
  if (text.length < 1) return fail(400, "Напишите сообщение.");
  if (text.length > CHAT_MAX_TEXT) return fail(400, `Сообщение — не длиннее ${CHAT_MAX_TEXT} символов.`);
  const people = await loadPeople([actorId, input.toUserId]);
  const me = people.get(actorId);
  const other = people.get(input.toUserId);
  if (!me || !other) return fail(404, "Собеседник не найден.");
  const pair = pairOf(actorId, input.toUserId);
  const existing = await prisma.chatThread.findUnique({ where: { userAId_userBId: pair } });
  const state = { zgdSpoke: existing?.zgdSpoke ?? false, closed: !!existing?.closedAt };
  if (!canPostInChat(me, other, state)) return fail(403, chatBlockReason(me, other, state) ?? "Писать этому человеку нельзя.");
  if (input.itemId) {
    // прикладывать можно задачу, которую видишь сам; ЗГД задач не прикладывает (у него только подтверждённые)
    const ok = me.role !== "EXECUTIVE" && (await resolveItems(me, [input.itemId])).get(input.itemId);
    if (!ok) return fail(400, "Эта задача недоступна для прикрепления.");
  }
  const zgdWrites = me.role === "EXECUTIVE";
  const { thread, message } = await prisma.$transaction(async (tx) => {
    const thread = await tx.chatThread.upsert({ where: { userAId_userBId: pair }, create: { ...pair, startedById: actorId, zgdSpoke: zgdWrites }, update: { lastMessageAt: new Date(), ...(zgdWrites ? { zgdSpoke: true, closedAt: null } : {}) } });
    const message = await tx.chatMessage.create({ data: { threadId: thread.id, authorId: actorId, text, itemId: input.itemId ?? null } });
    await tx.chatRead.upsert({ where: { threadId_userId: { threadId: thread.id, userId: actorId } }, create: { threadId: thread.id, userId: actorId }, update: { lastReadAt: new Date() } });
    return { thread, message };
  });
  return { ok: true, data: { threadId: thread.id, message: (await toViews(me, [message]))[0] } };
}

/** ЗГД закрывает диалог: руководитель снова сможет ответить только после нового сообщения ЗГД. */
export async function closeThread(actorId: string, threadId: string): Promise<ChatResult<null>> {
  const t = await prisma.chatThread.findUnique({ where: { id: threadId } });
  if (!t || (t.userAId !== actorId && t.userBId !== actorId)) return fail(404, "Диалог не найден.");
  const me = (await loadPeople([actorId])).get(actorId);
  if (me?.role !== "EXECUTIVE") return fail(403, "Закрыть диалог может только ЗГД.");
  await prisma.chatThread.update({ where: { id: threadId }, data: { closedAt: new Date() } });
  return { ok: true, data: null };
}

/** Поиск задач для «Прикрепить задачу»: свои (по дирекции; админ — рабочей дирекции), не удалённые. */
export async function searchItemsForChat(actor: { id: string; role: string; directorateId?: string | null }, q: string): Promise<Array<{ id: string; title: string }>> {
  if (actor.role === "EXECUTIVE" || !actor.directorateId) return [];
  const term = q.trim().slice(0, 80);
  return prisma.operationalItem.findMany({ where: { directorateId: actor.directorateId, archivedAt: null, ...(term ? { title: { contains: term, mode: "insensitive" } } : {}) }, orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, title: true } });
}

/** Ежедневная уборка: сообщения старше срока хранения, затем пустые диалоги. */
export async function pruneChat(now = new Date()): Promise<{ messages: number; threads: number }> {
  const cutoff = new Date(now.getTime() - CHAT_RETENTION_DAYS * 864e5);
  const messages = (await prisma.chatMessage.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
  const threads = (await prisma.chatThread.deleteMany({ where: { messages: { none: {} }, createdAt: { lt: cutoff } } })).count;
  return { messages, threads };
}
