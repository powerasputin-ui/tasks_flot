"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Paperclip, Send, Users, X } from "lucide-react";
import { api, GroupAvatar, hm, postJson, sub } from "@/components/chat/shared";
import { Members } from "@/components/chat/Members";
import { PersonAvatar, personColor } from "@/components/ui/Person";
import { CHAT_MAX_ITEMS, CHAT_MAX_TEXT, mentionsIn } from "@/lib/chat-rules";
import type { ChatMessageView, ChatPersonView, ChatThreadDetail } from "@/lib/chat-server";

type Picked = { id: string; title: string };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Текст сообщения: «@Имя» упомянутых выделено. */
function Body({ text, mentions }: { text: string; mentions: Array<{ id: string; name: string }> }) {
  if (mentions.length === 0) return <>{text}</>;
  const re = new RegExp(`(${mentions.map((m) => esc(`@${m.name}`)).join("|")})`, "g");
  return (
    <>
      {text.split(re).map((part, i) =>
        mentions.some((m) => part === `@${m.name}`) ? (
          <span key={i} className="rounded-sm bg-primary-soft px-0.5 font-semibold text-primary">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Окно диалога: личный, группа или чат по задаче (с закреплённой карточкой задачи). Опрос раз в 4 с, пока окно открыто. */
export function Thread({ meId, threadId: initialId, other, onUnread, onBack, onClose }: { meId: string; threadId: string | null; other: ChatPersonView | null; onUnread: (n: number) => void; onBack: () => void; onClose: () => void }) {
  const [threadId, setThreadId] = useState(initialId);
  const [detail, setDetail] = useState<ChatThreadDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [text, setText] = useState("");
  const [items, setItems] = useState<Picked[]>([]);
  const [picker, setPicker] = useState(false);
  const [found, setFound] = useState<Picked[]>([]);
  const [itemQuery, setItemQuery] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const last = useRef<string | null>(null);
  const reload = useRef<() => void>(() => {});

  const merge = useCallback((incoming: ChatMessageView[], replace: boolean) => {
    setMessages((cur) => {
      const base = replace ? [] : cur;
      const seen = new Set(base.map((m) => m.id));
      return [...base, ...incoming.filter((m) => !seen.has(m.id))];
    });
  }, []);

  useEffect(() => {
    if (!threadId) return;
    let stop = false;
    const load = async (first: boolean) => {
      if (!first && document.hidden) return;
      const qs = first || !last.current ? "?markRead=1" : `?markRead=1&since=${encodeURIComponent(last.current)}`;
      const r = await api<ChatThreadDetail>(`/api/chat/threads/${threadId}${qs}`);
      if (stop) return;
      if (!r.ok) {
        if (r.status === 404 && !first) return onBack(); // убрали из группы или группу удалили
        if (first) setError(r.message);
        return;
      }
      setDetail(r.data);
      merge(r.data.messages, first || !last.current);
      const lastMsg = r.data.messages.at(-1);
      if (lastMsg) last.current = lastMsg.createdAt;
      if (r.data.messages.length) {
        const list = await api<{ unreadTotal: number }>("/api/chat");
        if (!stop && list.ok) onUnread(list.data.unreadTotal);
      }
    };
    reload.current = () => {
      last.current = null;
      void load(true);
    };
    void load(true);
    const t = setInterval(() => void load(false), 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [threadId, merge, onUnread, onBack]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // поле растёт по тексту до 7 строк; полоса прокрутки — только когда строк больше
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
    el.style.overflowY = el.scrollHeight > 140 ? "auto" : "hidden";
  }, [text]);

  useEffect(() => {
    if (!picker) return;
    const t = setTimeout(async () => {
      const r = await api<{ items: Picked[] }>(`/api/chat/items?q=${encodeURIComponent(itemQuery)}`);
      if (r.ok) setFound(r.data.items);
    }, 200);
    return () => clearTimeout(t);
  }, [picker, itemQuery]);

  const kind = detail?.kind ?? (other ? "DIRECT" : "GROUP");
  const group = kind !== "DIRECT";
  // кого можно упомянуть: участники группы или собеседник
  const people: Array<{ id: string; name: string }> = group ? (detail?.members ?? []).filter((m) => m.id !== meId && m.isActive) : other ? [other] : [];
  const nameOf = (id: string) => (id === meId ? "Вы" : detail?.members.find((m) => m.id === id)?.name ?? (other?.id === id ? other.name : "участник"));
  const mq = /@([^\s@]*)$/.exec(text);
  const suggestions = mq ? people.filter((p) => p.name.toLowerCase().includes(mq[1].toLowerCase())).slice(0, 5) : [];

  async function send() {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    const mentionIds = mentionsIn(text, people);
    const base = { text, itemIds: items.map((i) => i.id), mentionIds };
    const r = await postJson<{ threadId: string; message: ChatMessageView }>("/api/chat", threadId ? { threadId, ...base } : { toUserId: other!.id, ...base });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setText("");
    setItems([]);
    setPicker(false);
    merge([r.data.message], false);
    last.current = r.data.message.createdAt;
    if (!threadId) setThreadId(r.data.threadId);
  }

  async function closeDialog() {
    if (!threadId) return;
    const r = await postJson<{ ok: true }>(`/api/chat/threads/${threadId}`, { action: "close" });
    if (!r.ok) return setError(r.message);
    reload.current();
  }

  const canPost = threadId ? detail?.canPost ?? false : true;
  const title = detail?.title ?? other?.name ?? "Чат";
  const card = detail?.taskCard;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant bg-surface-low px-3 py-2.5">
        <button onClick={onBack} aria-label="К списку диалогов" className="btn-icon h-7 w-7">
          <ArrowLeft size={16} />
        </button>
        {group ? <GroupAvatar title={title} size={30} /> : other && <PersonAvatar name={other.name} size={30} />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-on-surface">{title}</div>
          <div className="truncate text-[11px] text-on-surface-variant">{group ? `${kind === "TASK" ? "Обсуждение задачи · " : ""}${detail?.members.length ?? "…"} участн.` : other ? sub(other) : ""}</div>
        </div>
        {group && detail && (
          <button onClick={() => setShowMembers(true)} aria-label="Участники" title="Участники" className="btn-icon h-7 w-7">
            <Users size={16} />
          </button>
        )}
        <button onClick={onClose} aria-label="Закрыть чат" className="btn-icon h-7 w-7">
          <X size={16} />
        </button>
      </div>

      {card && (
        <div className="shrink-0 border-b border-outline-variant bg-primary-soft/40 px-3 py-2 text-[12px]">
          {card.state === "ok" ? (
            <>
              <Link href={`/tracker?item=${card.itemId}`} className="flex items-center gap-1 font-semibold text-primary hover:underline">
                <Paperclip size={12} className="shrink-0" /> <span className="line-clamp-2">{card.title}</span>
              </Link>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-on-surface-variant">
                {card.statusName && <span>{card.statusName}</span>}
                {card.deadline && <span>срок {new Date(card.deadline).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}</span>}
                {card.ownerName && <span>{card.ownerName}</span>}
              </div>
            </>
          ) : (
            <span className="italic text-on-surface-variant">{card.state === "deleted" ? "Задача удалена" : "Карточка задачи вам недоступна"}</span>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-surface-low/40 p-3">
        {threadId && !detail && !error && <div className="skeleton h-10 w-2/3 rounded-lg" />}
        {!threadId && other && <p className="py-6 text-center text-[12px] text-on-surface-variant">Диалога ещё нет. Напишите первое сообщение — {other.name} увидит его в чате.</p>}
        {messages.map((m) => {
          if (m.kind === "SYSTEM") return <p key={m.id} className="py-0.5 text-center text-[11px] text-outline">{m.text}</p>;
          const mine = m.authorId === meId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-1.5 text-[13px] ${mine ? "bg-primary-soft text-on-surface" : "bg-surface-high text-on-surface"}`}>
                {group && !mine && <p className="text-[11px] font-semibold" style={{ color: personColor(nameOf(m.authorId)) }}>{nameOf(m.authorId)}</p>}
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <Body text={m.text} mentions={m.mentions} />
                </p>
                {m.items.map((i) => (
                  <Link key={i.id} href={`/tracker?item=${i.id}`} className="mt-1 flex items-center gap-1 rounded-md border border-outline-variant bg-surface px-2 py-1 text-[12px] font-semibold text-primary hover:underline">
                    <Paperclip size={12} className="shrink-0" /> <span className="line-clamp-2">{i.title}</span>
                  </Link>
                ))}
                {m.hiddenItems > 0 && <p className="mt-1 text-[11px] italic text-outline">{m.items.length ? "и " : ""}приложено задач, недоступных вам: {m.hiddenItems}</p>}
                <p className="mt-0.5 text-right text-[10px] text-outline">{hm(m.createdAt)}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {error && <p className="shrink-0 border-t border-outline-variant px-3 py-1.5 text-[12px] text-status-red">{error}</p>}
      {detail?.canClose && threadId && (
        <div className="shrink-0 border-t border-outline-variant px-3 py-1.5 text-right">
          <button onClick={() => void closeDialog()} className="text-[11px] font-semibold text-on-surface-variant hover:underline" title="После закрытия руководитель сможет ответить только после вашего нового сообщения">
            Закрыть диалог
          </button>
        </div>
      )}

      {canPost ? (
        <div className="shrink-0 space-y-1.5 border-t border-outline-variant p-2">
          {suggestions.length > 0 && (
            <ul className="max-h-32 overflow-y-auto rounded-md border border-outline-variant bg-surface">
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      setText((t) => t.replace(/@([^\s@]*)$/, `@${p.name} `));
                      taRef.current?.focus();
                    }}
                    className="block w-full truncate px-2 py-1.5 text-left text-[12px] hover:bg-surface-low"
                  >
                    @{p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picker && (
            <div className="rounded-md border border-outline-variant bg-surface">
              <div className="p-1.5">
                <input value={itemQuery} onChange={(e) => setItemQuery(e.target.value)} placeholder={`Найти задачу (до ${CHAT_MAX_ITEMS})`} className="input h-8 w-full text-[12px]" />
              </div>
              <ul className="max-h-32 overflow-y-auto">
                {found.length === 0 && <li className="px-2 py-1.5 text-[12px] text-on-surface-variant">Ничего не найдено</li>}
                {found.map((i) => {
                  const on = items.some((x) => x.id === i.id);
                  return (
                    <li key={i.id}>
                      <button onClick={() => setItems((l) => (on ? l.filter((x) => x.id !== i.id) : l.length >= CHAT_MAX_ITEMS ? l : [...l, i]))} aria-pressed={on} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-surface-low">
                        <span className="min-w-0 flex-1 truncate">{i.title}</span>
                        {on && <Check size={14} className="shrink-0 text-primary" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {items.length > 0 && (
            <div className="space-y-1">
              {items.map((i) => (
                <div key={i.id} className="flex items-center gap-1 rounded-md bg-primary-soft px-2 py-1 text-[12px] text-primary">
                  <Paperclip size={12} /> <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <button onClick={() => setItems((l) => l.filter((x) => x.id !== i.id))} aria-label="Убрать задачу" className="shrink-0">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-1.5">
            {other?.role !== "EXECUTIVE" && (
              <button onClick={() => setPicker((p) => !p)} aria-label="Прикрепить задачу" title="Прикрепить задачу (до 3)" className="btn-icon h-8 w-8 shrink-0">
                <Paperclip size={16} />
              </button>
            )}
            <textarea
              ref={taRef}
              value={text}
              rows={1}
              maxLength={CHAT_MAX_TEXT}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && suggestions.length === 0) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={group ? "Сообщение… @ — упомянуть, Enter — отправить" : "Сообщение… Enter — отправить"}
              className="input min-h-8 flex-1 resize-none overflow-hidden py-1.5 text-[13px] leading-5"
            />
            <button onClick={() => void send()} disabled={busy || !text.trim()} aria-label="Отправить" title="Отправить" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white disabled:opacity-40">
              <Send size={15} />
            </button>
          </div>
        </div>
      ) : (
        <p className="shrink-0 border-t border-outline-variant bg-surface-low px-3 py-2.5 text-[12px] text-on-surface-variant">{detail?.blockReason ?? "Писать в этот диалог нельзя."}</p>
      )}

      {showMembers && detail && (
        <div className="absolute inset-0 z-10 flex flex-col bg-surface">
          <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant bg-surface-low px-3 py-2.5">
            <button onClick={() => setShowMembers(false)} aria-label="Назад к переписке" className="btn-icon h-7 w-7">
              <ArrowLeft size={16} />
            </button>
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-on-surface">{title}</span>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <Members
              detail={detail}
              meId={meId}
              onChanged={() => reload.current()}
              onGone={() => {
                setShowMembers(false);
                onBack();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
