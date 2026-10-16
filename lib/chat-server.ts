import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";
import { canAddToChat, canDiscussItem, canPostInChat, CHAT_MAX_ITEMS, CHAT_MAX_TEXT, CHAT_RETENTION_DAYS, chatBlockReason, GROUP_MAX_MEMBERS, GROUP_MAX_PER_USER, GROUP_TITLE_MAX, nextOwner, pairOf, type ChatPerson } from "@/lib/chat-rules";

/** Чат: личные диалоги, группы и чат по задаче. Запросы к базе; права — lib/chat-rules.ts (те же функции проверяют каждое действие). */
export type ChatResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; message: string };
const fail = (status: number, message: string): { ok: false; status: number; error: string; message: string } => ({ ok: false, status, error: status === 404 ? "NOT_FOUND" : status === 403 ? "FORBIDDEN" : "INVALID_INPUT", message });

type PersonRow = ChatPerson & { name: string; directorateName: string | null };
type Tx = Prisma.TransactionClient;
export type ChatKind = "DIRECT" | "GROUP" | "TASK";

async function loadPeople(ids: string[]): Promise<Map<string, PersonRow>> {
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true, isActive: true, directorateId: true, directorate: { select: { name: true, shortName: true } } } });
  return new Map(users.map((u) => [u.id, { id: u.id, name: u.name, role: u.role, isActive: u.isActive, directorateId: u.directorateId, directorateName: u.directorate ? u.directorate.shortName ?? u.directorate.name : null }]));
}

export type ChatPersonView = { id: string; name: string; role: string; directorateName: string | null };
const view = (p: PersonRow): ChatPersonView => ({ id: p.id, name: p.name, role: p.role, directorateName: p.directorateName });

/** Кому actor может написать первым или кого добавить в группу (список выбора). */
export async function chatPeople(actorId: string): Promise<ChatPersonView[]> {
  const me = (await loadPeople([actorId])).get(actorId);
  if (!me || me.isActive === false) return [];
  const users = await prisma.user.findMany({ where: { isActive: true, id: { not: actorId }, role: { in: ["HEAD", "DIRECTOR", "ADMIN", "EXECUTIVE"] } }, select: { id: true }, take: 500 });
  const people = await loadPeople(users.map((u) => u.id));
  return [...people.values()].filter((p) => canAddToChat(me, p)).sort((a, b) => a.name.localeCompare(b.name, "ru")).map(view);
}

/** Участие в диалоге. Личный диалог, созданный до появления участников, достраивается на лету. */
async function membership(threadId: string, userId: string) {
  const m = await prisma.chatMember.findUnique({ where: { threadId_userId: { threadId, userId } }, include: { thread: true } });
  if (m) return { thread: m.thread, role: m.role };
  const t = await prisma.chatThread.findUnique({ where: { id: threadId } });
  if (!t || t.kind !== "DIRECT" || (t.userAId !== userId && t.userBId !== userId)) return null;
  await prisma.chatMember.createMany({ data: [t.userAId, t.userBId].filter((x): x is string => !!x).map((u) => ({ threadId, userId: u })), skipDuplicates: true });
  return { thread: t, role: "MEMBER" };
}

// ---------- задачи в сообщениях и закреплённая карточка

type ItemAccess = { viewer: PersonRow; item: { directorateId: string | null; publishedAt: Date | null } };
const itemVisible = ({ viewer, item }: ItemAccess) => viewer.role === "ADMIN" || (viewer.role === "EXECUTIVE" ? !!item.publishedAt : item.directorateId === viewer.directorateId);

/** Задачи по ссылкам: название видит только тот, кому задача доступна (своя дирекция, админ; ЗГД — подтверждённые для него). */
async function resolveItems(viewer: PersonRow, ids: string[]): Promise<Map<string, { id: string; title: string } | null>> {
  const out = new Map<string, { id: string; title: string } | null>();
  if (ids.length === 0) return out;
  const items = await prisma.operationalItem.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, directorateId: true, publishedAt: true, archivedAt: true } });
  for (const i of items) out.set(i.id, !i.archivedAt && itemVisible({ viewer, item: i }) ? { id: i.id, title: i.title } : null);
  return out;
}

export type ChatMessageView = { id: string; authorId: string; kind: "TEXT" | "SYSTEM"; text: string; createdAt: string; items: Array<{ id: string; title: string }>; hiddenItems: number; mentions: Array<{ id: string; name: string }> };

type MsgRow = { id: string; authorId: string; kind: string; text: string; createdAt: Date; itemId: string | null; itemIds: Prisma.JsonValue | null; mentionIds: Prisma.JsonValue | null };
const asIds = (v: Prisma.JsonValue | null): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const itemIdsOf = (m: MsgRow): string[] => [...new Set([...(m.itemId ? [m.itemId] : []), ...asIds(m.itemIds)])];

async function toViews(viewer: PersonRow, msgs: MsgRow[]): Promise<ChatMessageView[]> {
  const items = await resolveItems(viewer, [...new Set(msgs.flatMap(itemIdsOf))]);
  const people = await loadPeople([...new Set(msgs.flatMap((m) => asIds(m.mentionIds)))]);
  return msgs.map((m) => {
    const ids = itemIdsOf(m);
    const shown = ids.map((i) => items.get(i)).filter((x): x is { id: string; title: string } => !!x);
    return {
      id: m.id,
      authorId: m.authorId,
      kind: m.kind === "SYSTEM" ? "SYSTEM" : "TEXT",
      text: m.text,
      createdAt: m.createdAt.toISOString(),
      items: shown,
      hiddenItems: ids.length - shown.length,
      mentions: asIds(m.mentionIds).flatMap((id) => (people.get(id) ? [{ id, name: people.get(id)!.name }] : [])),
    };
  });
}

export type ChatTaskCard = { itemId: string; state: "ok" | "unavailable" | "deleted"; title?: string; statusName?: string | null; deadline?: string | null; ownerName?: string | null };

async function taskCardOf(viewer: PersonRow, itemId: string): Promise<ChatTaskCard> {
  const i = await prisma.operationalItem.findUnique({ where: { id: itemId }, select: { title: true, directorateId: true, publishedAt: true, archivedAt: true, deadline: true, status: { select: { name: true } }, responsible: { select: { name: true } } } });
  if (!i) return { itemId, state: "deleted" };
  if (!itemVisible({ viewer, item: i })) return { itemId, state: "unavailable" };
  if (i.archivedAt) return { itemId, state: "deleted", title: i.title };
  return { itemId, state: "ok", title: i.title, statusName: i.status?.name ?? null, deadline: i.deadline?.toISOString() ?? null, ownerName: i.responsible?.name ?? null };
}

// ---------- список диалогов

export type ChatThreadView = { id: string; kind: ChatKind; title: string | null; other: ChatPersonView | null; memberCount: number; lastText: string | null; lastAt: string; lastMine: boolean; unread: number; mention: boolean; canPost: boolean };

export async function listThreads(actorId: string): Promise<{ threads: ChatThreadView[]; unreadTotal: number }> {
  const threads = await prisma.chatThread.findMany({ where: { OR: [{ members: { some: { userId: actorId } } }, { userAId: actorId }, { userBId: actorId }] }, orderBy: { lastMessageAt: "desc" }, take: 60 });
  if (threads.length === 0) return { threads: [], unreadTotal: 0 };
  const ids = threads.map((t) => t.id);
  const directOther = (t: (typeof threads)[number]) => (t.kind === "DIRECT" ? (t.userAId === actorId ? t.userBId : t.userAId) : null);
  const [members, lasts, unreads] = await Promise.all([
    prisma.chatMember.groupBy({ by: ["threadId"], where: { threadId: { in: ids } }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ threadId: string; text: string; authorId: string; kind: string }>>`SELECT DISTINCT ON ("threadId") "threadId", "text", "authorId", "kind" FROM chat_messages WHERE "threadId" = ANY(${ids}) ORDER BY "threadId", "createdAt" DESC`,
    prisma.$queryRaw<Array<{ threadId: string; c: number; mc: number }>>`SELECT m."threadId", COUNT(*)::int AS c, (COUNT(*) FILTER (WHERE m."mentionIds" @> to_jsonb(${actorId}::text)))::int AS mc FROM chat_messages m JOIN chat_members cm ON cm."threadId" = m."threadId" AND cm."userId" = ${actorId} LEFT JOIN chat_reads r ON r."threadId" = m."threadId" AND r."userId" = ${actorId} WHERE m."threadId" = ANY(${ids}) AND m."kind" = 'TEXT' AND m."authorId" <> ${actorId} AND m."createdAt" > COALESCE(r."lastReadAt", 'epoch'::timestamp) GROUP BY m."threadId"`,
  ]);
  const people = await loadPeople([actorId, ...threads.flatMap((t) => directOther(t) ?? [])]);
  const taskItems = await resolveItems(people.get(actorId) ?? ({ id: actorId, role: "HEAD", directorateId: null, name: "", directorateName: null } as PersonRow), threads.flatMap((t) => (t.itemId ? [t.itemId] : [])));
  const me = people.get(actorId);
  const countBy = new Map(members.map((m) => [m.threadId, m._count._all]));
  const lastBy = new Map(lasts.map((l) => [l.threadId, l]));
  const unreadBy = new Map(unreads.map((u) => [u.threadId, u]));
  const out: ChatThreadView[] = [];
  for (const t of threads) {
    if (!me) break;
    const otherId = directOther(t);
    const other = otherId ? people.get(otherId) ?? null : null;
    if (t.kind === "DIRECT" && !other) continue;
    const last = lastBy.get(t.id);
    const u = unreadBy.get(t.id);
    out.push({
      id: t.id,
      kind: (t.kind as ChatKind) ?? "DIRECT",
      title: t.kind === "TASK" ? (t.itemId && taskItems.get(t.itemId)?.title) || "Чат по задаче" : t.title,
      other: other ? view(other) : null,
      memberCount: countBy.get(t.id) ?? 2,
      lastText: last?.text.slice(0, 120) ?? null,
      lastAt: t.lastMessageAt.toISOString(),
      lastMine: last?.authorId === actorId && last.kind === "TEXT",
      unread: u?.c ?? 0,
      mention: (u?.mc ?? 0) > 0,
      canPost: me.isActive !== false && (t.kind === "DIRECT" && other ? canPostInChat(me, other, { zgdSpoke: t.zgdSpoke, closed: !!t.closedAt }) : true),
    });
  }
  return { threads: out, unreadTotal: out.reduce((s, t) => s + t.unread, 0) };
}

/** Сколько непрочитанных сообщений у человека (значок на кнопке чата). Системные записи не считаются. */
export async function unreadTotal(actorId: string): Promise<number> {
  const r = await prisma.$queryRaw<Array<{ c: number }>>`SELECT COUNT(*)::int AS c FROM chat_messages m JOIN chat_members cm ON cm."threadId" = m."threadId" AND cm."userId" = ${actorId} LEFT JOIN chat_reads r ON r."threadId" = m."threadId" AND r."userId" = ${actorId} WHERE m."kind" = 'TEXT' AND m."authorId" <> ${actorId} AND m."createdAt" > COALESCE(r."lastReadAt", 'epoch'::timestamp)`;
  return r[0]?.c ?? 0;
}

// ---------- диалог

export type ChatMemberView = ChatPersonView & { isOwner: boolean; isActive: boolean };
export type ChatThreadDetail = {
  id: string;
  kind: ChatKind;
  title: string | null;
  other: ChatPersonView | null;
  members: ChatMemberView[];
  closed: boolean;
  canPost: boolean;
  blockReason: string | null;
  canClose: boolean;
  canAdd: boolean;
  canManage: boolean;
  taskCard: ChatTaskCard | null;
  messages: ChatMessageView[];
};

/** Диалог с сообщениями; since — только новое (клиент опрашивает), markRead — отметить прочитанным. Не участник — 404. */
export async function getThread(actorId: string, threadId: string, opts: { since?: Date; markRead?: boolean } = {}): Promise<ChatResult<ChatThreadDetail>> {
  const mem = await membership(threadId, actorId);
  if (!mem) return fail(404, "Диалог не найден.");
  const t = mem.thread;
  const kind = (t.kind as ChatKind) ?? "DIRECT";
  const memberRows = await prisma.chatMember.findMany({ where: { threadId }, orderBy: { joinedAt: "asc" } });
  const people = await loadPeople([actorId, ...memberRows.map((m) => m.userId)]);
  const me = people.get(actorId);
  if (!me) return fail(404, "Диалог не найден.");
  const otherId = kind === "DIRECT" ? (t.userAId === actorId ? t.userBId : t.userAId) : null;
  const other = otherId ? people.get(otherId) ?? (await loadPeople([otherId])).get(otherId) ?? null : null;
  const rows = opts.since
    ? await prisma.chatMessage.findMany({ where: { threadId, createdAt: { gte: opts.since } }, orderBy: { createdAt: "asc" }, take: 200 })
    : (await prisma.chatMessage.findMany({ where: { threadId }, orderBy: { createdAt: "desc" }, take: 100 })).reverse();
  if (opts.markRead) await prisma.chatRead.upsert({ where: { threadId_userId: { threadId, userId: actorId } }, create: { threadId, userId: actorId }, update: { lastReadAt: new Date() } });
  const state = { zgdSpoke: t.zgdSpoke, closed: !!t.closedAt };
  const direct = kind === "DIRECT" && other;
  const canPost = me.isActive !== false && (direct ? canPostInChat(me, other, state) : true);
  const taskCard = t.itemId ? await taskCardOf(me, t.itemId) : null;
  return {
    ok: true,
    data: {
      id: t.id,
      kind,
      title: kind === "TASK" ? taskCard?.title ?? "Чат по задаче" : t.title,
      other: other ? view(other) : null,
      members: kind === "DIRECT" ? [] : memberRows.flatMap((m) => (people.get(m.userId) ? [{ ...view(people.get(m.userId)!), isOwner: m.role === "OWNER", isActive: people.get(m.userId)!.isActive !== false }] : [])),
      closed: state.closed,
      canPost,
      blockReason: direct ? chatBlockReason(me, other, state) : canPost ? null : "Учётная запись отключена — писать нельзя.",
      canClose: kind === "DIRECT" && me.role === "EXECUTIVE" && !state.closed,
      canAdd: kind !== "DIRECT" && me.isActive !== false,
      canManage: kind !== "DIRECT" && mem.role === "OWNER",
      taskCard,
      messages: await toViews(me, rows),
    },
  };
}

// ---------- отправка

export type SendInput = { toUserId?: string; threadId?: string; text: string; itemIds?: string[]; mentionIds?: string[] };

const homeFor = (role: string) => (role === "EXECUTIVE" ? "/tracker" : "/table");

/** Написать: человеку (диалог создаётся при первом сообщении по паре) или в существующий диалог/группу. Права — chat-rules. */
export async function sendMessage(actorId: string, input: SendInput): Promise<ChatResult<{ threadId: string; message: ChatMessageView }>> {
  const text = input.text.trim();
  if (text.length < 1) return fail(400, "Напишите сообщение.");
  if (text.length > CHAT_MAX_TEXT) return fail(400, `Сообщение — не длиннее ${CHAT_MAX_TEXT} символов.`);
  const itemIds = [...new Set(input.itemIds ?? [])];
  if (itemIds.length > CHAT_MAX_ITEMS) return fail(400, `К сообщению можно приложить не больше ${CHAT_MAX_ITEMS} задач.`);

  let threadId: string | null = null;
  let memberIds: string[] = [];
  let title: string | null = null;
  let direct: { other: PersonRow; state: { zgdSpoke: boolean; closed: boolean }; pair: { userAId: string; userBId: string } } | null = null;

  if (input.threadId) {
    const mem = await membership(input.threadId, actorId);
    if (!mem) return fail(404, "Диалог не найден.");
    threadId = mem.thread.id;
    title = mem.thread.title;
    memberIds = (await prisma.chatMember.findMany({ where: { threadId }, select: { userId: true } })).map((m) => m.userId);
    if (mem.thread.kind === "DIRECT") {
      const otherId = mem.thread.userAId === actorId ? mem.thread.userBId : mem.thread.userAId;
      const people = await loadPeople([actorId, otherId ?? ""]);
      const other = otherId ? people.get(otherId) : undefined;
      if (!other) return fail(404, "Собеседник не найден.");
      direct = { other, state: { zgdSpoke: mem.thread.zgdSpoke, closed: !!mem.thread.closedAt }, pair: pairOf(actorId, other.id) };
    }
  } else if (input.toUserId) {
    const people = await loadPeople([actorId, input.toUserId]);
    const other = people.get(input.toUserId);
    if (!other || !people.get(actorId)) return fail(404, "Собеседник не найден.");
    const pair = pairOf(actorId, input.toUserId);
    const existing = await prisma.chatThread.findUnique({ where: { userAId_userBId: pair } });
    direct = { other, state: { zgdSpoke: existing?.zgdSpoke ?? false, closed: !!existing?.closedAt }, pair };
    threadId = existing?.id ?? null;
    memberIds = [actorId, other.id];
  } else return fail(400, "Укажите, кому написать.");

  const people = await loadPeople([actorId, ...memberIds]);
  const me = people.get(actorId);
  if (!me) return fail(404, "Собеседник не найден.");
  if (me.isActive === false) return fail(403, "Учётная запись отключена — писать нельзя.");
  if (direct && !canPostInChat(me, direct.other, direct.state)) return fail(403, chatBlockReason(me, direct.other, direct.state) ?? "Писать этому человеку нельзя.");
  if (itemIds.length) {
    // прикладывать можно задачи, которые видишь сам; ЗГД задач не прикладывает (у него только подтверждённые)
    const found = me.role === "EXECUTIVE" ? new Map() : await resolveItems(me, itemIds);
    if (itemIds.some((i) => !found.get(i))) return fail(400, "Одна из задач недоступна для прикрепления.");
  }
  const mentionIds = [...new Set(input.mentionIds ?? [])].filter((id) => id !== actorId && memberIds.includes(id));
  const zgdWrites = me.role === "EXECUTIVE" && !!direct;

  const { thread, message } = await prisma.$transaction(async (tx) => {
    let id = threadId;
    if (!id && direct) {
      const t = await tx.chatThread.upsert({ where: { userAId_userBId: direct.pair }, create: { ...direct.pair, kind: "DIRECT", startedById: actorId, zgdSpoke: zgdWrites }, update: {} });
      id = t.id;
      await tx.chatMember.createMany({ data: [actorId, direct.other.id].map((u) => ({ threadId: t.id, userId: u })), skipDuplicates: true });
    }
    const thread = await tx.chatThread.update({ where: { id: id! }, data: { lastMessageAt: new Date(), ...(zgdWrites ? { zgdSpoke: true, closedAt: null } : {}) } });
    const message = await tx.chatMessage.create({ data: { threadId: thread.id, authorId: actorId, text, itemIds: itemIds.length ? itemIds : undefined, mentionIds: mentionIds.length ? mentionIds : undefined } });
    await tx.chatRead.upsert({ where: { threadId_userId: { threadId: thread.id, userId: actorId } }, create: { threadId: thread.id, userId: actorId }, update: { lastReadAt: new Date() } });
    return { thread, message };
  });

  // упоминание — уведомление в колокольчик со ссылкой, которая открывает чат (одно на сообщение, ошибки не мешают отправке)
  for (const id of mentionIds) {
    const p = people.get(id);
    if (!p || p.isActive === false) continue;
    try {
      await createNotification({ userId: id, type: "CHANGE_ATTENTION", message: `${me.name} упомянул(а) вас в чате${title ? ` «${title}»` : ""}: ${text.slice(0, 80)}`, link: `${homeFor(p.role)}?chat=${thread.id}` });
    } catch (e) {
      console.error("chat mention notification failed", e);
    }
  }
  return { ok: true, data: { threadId: thread.id, message: (await toViews(me, [message]))[0] } };
}

// ---------- группы

async function addSystem(tx: Tx, threadId: string, authorId: string, text: string) {
  await tx.chatMessage.create({ data: { threadId, authorId, kind: "SYSTEM", text } });
  await tx.chatThread.update({ where: { id: threadId }, data: { lastMessageAt: new Date() } });
}
const names = (list: PersonRow[]) => list.map((p) => p.name).join(", ");

async function groupCount(userId: string): Promise<number> {
  return prisma.chatMember.count({ where: { userId, thread: { kind: { in: ["GROUP", "TASK"] } } } });
}

/** Новая группа: создатель — владелец; добавить можно тех, кому он вправе писать (ЗГД и админ — любых). */
export async function createGroup(actorId: string, input: { title: string; memberIds: string[] }): Promise<ChatResult<{ threadId: string }>> {
  const title = input.title.trim();
  if (title.length < 1) return fail(400, "Назовите группу.");
  if (title.length > GROUP_TITLE_MAX) return fail(400, `Название — не длиннее ${GROUP_TITLE_MAX} символов.`);
  const ids = [...new Set(input.memberIds)].filter((id) => id !== actorId);
  if (ids.length < 1) return fail(400, "Добавьте хотя бы одного участника.");
  if (ids.length + 1 > GROUP_MAX_MEMBERS) return fail(400, `В группе не больше ${GROUP_MAX_MEMBERS} участников.`);
  const people = await loadPeople([actorId, ...ids]);
  const me = people.get(actorId);
  if (!me || me.isActive === false) return fail(403, "Создавать группы нельзя.");
  const added = ids.map((id) => people.get(id));
  if (added.some((p) => !p || !canAddToChat(me, p))) return fail(403, "Одного из выбранных людей вам добавлять нельзя.");
  if ((await groupCount(actorId)) >= GROUP_MAX_PER_USER) return fail(400, `У вас уже ${GROUP_MAX_PER_USER} групп — выйдите из ненужных.`);
  const list = added as PersonRow[];
  const t = await prisma.$transaction(async (tx) => {
    const t = await tx.chatThread.create({ data: { kind: "GROUP", title, ownerId: actorId, startedById: actorId } });
    await tx.chatMember.createMany({ data: [{ threadId: t.id, userId: actorId, role: "OWNER", addedById: actorId }, ...ids.map((id) => ({ threadId: t.id, userId: id, addedById: actorId }))] });
    await tx.chatRead.create({ data: { threadId: t.id, userId: actorId } });
    await addSystem(tx, t.id, actorId, `${me.name} создал(а) группу и добавил(а): ${names(list)}`);
    return t;
  });
  return { ok: true, data: { threadId: t.id } };
}

/** Чат по задаче из карточки: один на задачу; участники — ответственный, директора дирекции задачи и тот, кто открыл. */
export async function openTaskChat(actorId: string, itemId: string): Promise<ChatResult<{ threadId: string }>> {
  const item = await prisma.operationalItem.findUnique({ where: { id: itemId }, select: { id: true, title: true, directorateId: true, responsibleId: true, archivedAt: true } });
  if (!item || item.archivedAt) return fail(404, "Задача не найдена.");
  const me = (await loadPeople([actorId])).get(actorId);
  if (!me || !canDiscussItem(me, item)) return fail(403, "Открыть чат по этой задаче нельзя.");
  const found = await prisma.chatThread.findUnique({ where: { itemId } });
  if (found) {
    const m = await prisma.chatMember.findUnique({ where: { threadId_userId: { threadId: found.id, userId: actorId } } });
    if (!m) {
      await prisma.$transaction(async (tx) => {
        await tx.chatMember.create({ data: { threadId: found.id, userId: actorId, addedById: actorId } });
        await addSystem(tx, found.id, actorId, `${me.name} присоединился(ась) к обсуждению`);
      });
    }
    return { ok: true, data: { threadId: found.id } };
  }
  const directors = item.directorateId ? await prisma.user.findMany({ where: { role: "DIRECTOR", isActive: true, directorateId: item.directorateId }, select: { id: true } }) : [];
  const ids = [...new Set([actorId, ...(item.responsibleId ? [item.responsibleId] : []), ...directors.map((d) => d.id)])];
  const active = await loadPeople(ids);
  const members = ids.filter((id) => id === actorId || active.get(id)?.isActive !== false);
  try {
    const t = await prisma.$transaction(async (tx) => {
      const t = await tx.chatThread.create({ data: { kind: "TASK", itemId, ownerId: actorId, startedById: actorId } });
      await tx.chatMember.createMany({ data: members.map((id) => ({ threadId: t.id, userId: id, role: id === actorId ? "OWNER" : "MEMBER", addedById: actorId })) });
      await tx.chatRead.create({ data: { threadId: t.id, userId: actorId } });
      await addSystem(tx, t.id, actorId, `${me.name} открыл(а) обсуждение задачи`);
      return t;
    });
    return { ok: true, data: { threadId: t.id } };
  } catch {
    // два человека открыли чат по одной задаче одновременно: уникальный itemId оставил один — открываем его
    const again = await prisma.chatThread.findUnique({ where: { itemId } });
    if (!again) throw new Error("chat task create failed");
    return { ok: true, data: { threadId: again.id } };
  }
}

export type GroupAction = { action: "rename"; title: string } | { action: "add"; userIds: string[] } | { action: "remove"; userId: string } | { action: "leave" } | { action: "delete" };

/** Управление группой и чатом по задаче: добавить (любой участник), убрать/переименовать/удалить (владелец), выйти (любой). */
export async function manageGroup(actorId: string, threadId: string, a: GroupAction): Promise<ChatResult<{ deleted?: boolean }>> {
  const mem = await membership(threadId, actorId);
  if (!mem) return fail(404, "Диалог не найден.");
  const t = mem.thread;
  if (t.kind === "DIRECT") return fail(400, "Это личный диалог.");
  const owner = mem.role === "OWNER";
  const memberRows = await prisma.chatMember.findMany({ where: { threadId } });
  const people = await loadPeople([actorId, ...memberRows.map((m) => m.userId)]);
  const me = people.get(actorId);
  if (!me) return fail(404, "Диалог не найден.");

  if (a.action === "rename") {
    if (!owner) return fail(403, "Переименовать группу может её владелец.");
    if (t.kind !== "GROUP") return fail(400, "Название чата по задаче — название задачи.");
    const title = a.title.trim();
    if (!title || title.length > GROUP_TITLE_MAX) return fail(400, `Название — от 1 до ${GROUP_TITLE_MAX} символов.`);
    await prisma.$transaction(async (tx) => {
      await tx.chatThread.update({ where: { id: threadId }, data: { title } });
      await addSystem(tx, threadId, actorId, `${me.name} переименовал(а) группу: «${title}»`);
    });
    return { ok: true, data: {} };
  }

  if (a.action === "delete") {
    if (!owner) return fail(403, "Удалить группу может её владелец.");
    await prisma.chatThread.delete({ where: { id: threadId } });
    return { ok: true, data: { deleted: true } };
  }

  if (a.action === "add") {
    if (me.isActive === false) return fail(403, "Учётная запись отключена.");
    const ids = [...new Set(a.userIds)].filter((id) => !memberRows.some((m) => m.userId === id));
    if (ids.length < 1) return fail(400, "Выберите людей, которых ещё нет в группе.");
    if (memberRows.length + ids.length > GROUP_MAX_MEMBERS) return fail(400, `В группе не больше ${GROUP_MAX_MEMBERS} участников.`);
    const targets = await loadPeople(ids);
    const list = ids.map((id) => targets.get(id));
    if (list.some((p) => !p || !canAddToChat(me, p))) return fail(403, "Одного из выбранных людей вам добавлять нельзя.");
    await prisma.$transaction(async (tx) => {
      await tx.chatMember.createMany({ data: ids.map((id) => ({ threadId, userId: id, addedById: actorId })), skipDuplicates: true });
      await addSystem(tx, threadId, actorId, `${me.name} добавил(а): ${names(list as PersonRow[])}`);
    });
    return { ok: true, data: {} };
  }

  // убрать участника (владелец) или выйти самому
  const targetId = a.action === "leave" ? actorId : a.userId;
  const target = memberRows.find((m) => m.userId === targetId);
  if (!target) return fail(404, "Участник не найден.");
  if (targetId !== actorId && !owner) return fail(403, "Убрать участника может владелец группы.");
  const targetName = people.get(targetId)?.name ?? "участник";
  const successor = target.role === "OWNER" ? nextOwner(memberRows.map((m) => ({ userId: m.userId, joinedAt: m.joinedAt, isActive: people.get(m.userId)?.isActive })), targetId) : null;
  if (target.role === "OWNER" && !successor) {
    // остался один человек (или одни отключённые): группа без живых участников не нужна
    await prisma.chatThread.delete({ where: { id: threadId } });
    return { ok: true, data: { deleted: true } };
  }
  await prisma.$transaction(async (tx) => {
    await tx.chatMember.delete({ where: { threadId_userId: { threadId, userId: targetId } } });
    await tx.chatRead.deleteMany({ where: { threadId, userId: targetId } });
    if (successor) {
      await tx.chatMember.update({ where: { threadId_userId: { threadId, userId: successor } }, data: { role: "OWNER" } });
      await tx.chatThread.update({ where: { id: threadId }, data: { ownerId: successor } });
    }
    await addSystem(tx, threadId, actorId, targetId === actorId ? `${targetName} вышел(а) из группы` : `${me.name} убрал(а): ${targetName}`);
  });
  return { ok: true, data: {} };
}

/** ЗГД закрывает личный диалог: руководитель снова сможет ответить только после нового сообщения ЗГД. */
export async function closeThread(actorId: string, threadId: string): Promise<ChatResult<null>> {
  const mem = await membership(threadId, actorId);
  if (!mem || mem.thread.kind !== "DIRECT") return fail(404, "Диалог не найден.");
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

/** Ежедневная уборка: сообщения старше срока хранения, затем пустые личные диалоги. Группы и чаты задач остаются. */
export async function pruneChat(now = new Date()): Promise<{ messages: number; threads: number }> {
  const cutoff = new Date(now.getTime() - CHAT_RETENTION_DAYS * 864e5);
  const messages = (await prisma.chatMessage.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
  const threads = (await prisma.chatThread.deleteMany({ where: { kind: "DIRECT", messages: { none: {} }, createdAt: { lt: cutoff } } })).count;
  return { messages, threads };
}
