"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, MessageSquare, Paperclip, Plus, Send, X } from "lucide-react";
import { PersonAvatar } from "@/components/ui/Person";
import { useIsMobile } from "@/lib/use-mobile";
import { CHAT_MAX_TEXT } from "@/lib/chat-rules";
import type { ChatMessageView, ChatPersonView, ChatThreadDetail, ChatThreadView } from "@/lib/chat-server";

const POS_KEY = "operativka.chat.pos.v2";
const ROLE_LABEL: Record<string, string> = { HEAD: "руководитель", DIRECTOR: "директор", ADMIN: "админ", EXECUTIVE: "ЗГД" };

const hm = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const dm = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });
const when = (iso: string) => (dm(iso) === dm(new Date().toISOString()) ? hm(iso) : dm(iso));
const sub = (p: ChatPersonView) => [ROLE_LABEL[p.role] ?? p.role, p.directorateName].filter(Boolean).join(" · ");

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; message: string; status: number }> {
  try {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    return { ok: false, status: res.status, message: body?.message ?? "Не удалось выполнить. Попробуйте ещё раз." };
  } catch {
    return { ok: false, status: 0, message: "Нет связи с сервером." };
  }
}

type Screen = { kind: "list" } | { kind: "new" } | { kind: "thread"; threadId: string | null; other: ChatPersonView };

const BALL = 56;
const GAP = 12;
const W = 384; // 24rem
const H = 544; // 34rem

/**
 * Чат — круглая кнопка того же размера, что шар «Оперативщика»: перетаскивается куда угодно (место запоминается, двойной щелчок —
 * вернуть), щелчок открывает и сворачивает окно. Если на странице есть шар Оперативщика, кнопка чата стоит над ним (как в Facebook) —
 * пока человек не поставил её сам. Окно раскрывается рядом с кнопкой; на телефоне — на весь экран.
 */
export function ChatDock({ meId }: { meId: string }) {
  const mobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [saved, setSaved] = useState<{ x: number; y: number } | null>(null);
  const [base, setBase] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null);
  const clamp = (x: number, y: number) => ({ x: Math.min(Math.max(8, x), window.innerWidth - BALL - 8), y: Math.min(Math.max(8, y), window.innerHeight - BALL - 8) });

  useEffect(() => {
    setMounted(true);
    try {
      const s = JSON.parse(localStorage.getItem(POS_KEY) ?? "null") as { x: number; y: number } | null;
      if (s && typeof s.x === "number" && typeof s.y === "number") setSaved(s);
    } catch {
      /* память браузера недоступна — место по умолчанию */
    }
  }, []);

  // место по умолчанию: над шаром Оперативщика, если он на странице, иначе правый нижний угол (на телефоне — над нижней панелью)
  useEffect(() => {
    const place = () => {
      const ai = document.querySelector("[data-ai-ball]")?.getBoundingClientRect();
      const next = ai && ai.width > 0 ? clamp(ai.left, ai.top - BALL - GAP) : clamp(window.innerWidth - BALL - 20, window.innerHeight - BALL - (window.innerWidth < 768 ? 80 : 20));
      setBase((b) => (b.x === next.x && b.y === next.y ? b : next));
    };
    place();
    const t = setInterval(place, 500);
    window.addEventListener("resize", place);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", place);
    };
  }, []);

  // значок: пока окно закрыто — раз в 30 с (вкладка видна); открытое окно обновляет его само
  useEffect(() => {
    if (open) return;
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      const r = await api<{ unread: number }>("/api/chat/unread");
      if (!stop && r.ok) setUnread(r.data.unread);
    };
    void tick();
    const t = setInterval(tick, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [open]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ other?: ChatPersonView }>).detail;
      setOpen(true);
      setScreen(d?.other ? { kind: "thread", threadId: null, other: d.other } : { kind: "list" });
    };
    window.addEventListener("chat:open", onOpen);
    return () => window.removeEventListener("chat:open", onOpen);
  }, []);

  if (!mounted || typeof document === "undefined") return null;
  const pos = dragPos ?? (saved ? clamp(saved.x, saved.y) : base);
  // окно — рядом с кнопкой: справа или слева от неё и выше или ниже, где хватает места
  const winLeft = Math.min(Math.max(8, pos.x + BALL - W), window.innerWidth - W - 8);
  const above = pos.y > H + GAP + 8 || pos.y > window.innerHeight / 2;
  const winStyle = above ? { left: winLeft, bottom: window.innerHeight - pos.y + GAP } : { left: winLeft, top: pos.y + BALL + GAP };

  return createPortal(
    <>
      {open && (
        <div role="dialog" aria-label="Чат" className={`fixed z-[45] flex flex-col overflow-hidden border border-outline-variant bg-surface shadow-2xl ${mobile ? "inset-x-0 bottom-0 top-16 rounded-t-xl" : "rounded-xl"}`} style={mobile ? undefined : { ...winStyle, width: W, height: Math.min(H, window.innerHeight - 24) }}>
          <Window meId={meId} screen={screen} setScreen={setScreen} onClose={() => setOpen(false)} onUnread={setUnread} />
        </div>
      )}
      {!(open && mobile) && (
        <button
          aria-label="Чат"
          aria-expanded={open}
          title={open ? "Свернуть чат" : "Чат · можно перетащить"}
          className="fixed z-40 flex cursor-grab touch-none select-none items-center justify-center rounded-full bg-primary text-white shadow-lg transition-transform hover:scale-105 active:scale-95 active:cursor-grabbing"
          style={{ left: pos.x, top: pos.y, width: BALL, height: BALL }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            // меньше 5 px — это ещё щелчок, а не перетаскивание
            if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
            d.moved = true;
            setDragPos(clamp(e.clientX - d.dx, e.clientY - d.dy));
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            if (d?.moved) {
              const p = clamp(e.clientX - d.dx, e.clientY - d.dy);
              setSaved(p);
              setDragPos(null);
              try {
                localStorage.setItem(POS_KEY, JSON.stringify(p));
              } catch {
                /* не сохранилось — останется до перезагрузки */
              }
            } else setOpen((o) => !o);
          }}
          onDoubleClick={() => {
            // двойной щелчок — вернуть на место по умолчанию (над Оперативщиком или в угол)
            setSaved(null);
            try {
              localStorage.removeItem(POS_KEY);
            } catch {
              /* ignore */
            }
          }}
        >
          <MessageSquare size={26} />
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-status-red px-1 text-[11px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
        </button>
      )}
    </>,
    document.body,
  );
}

function Window({ meId, screen, setScreen, onClose, onUnread }: { meId: string; screen: Screen; setScreen: (s: Screen) => void; onClose: () => void; onUnread: (n: number) => void }) {
  const title = screen.kind === "thread" ? screen.other.name : screen.kind === "new" ? "Новый диалог" : "Чат";
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant bg-surface-low px-3 py-2.5">
        {screen.kind !== "list" && (
          <button onClick={() => setScreen({ kind: "list" })} aria-label="К списку диалогов" className="btn-icon h-7 w-7">
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-on-surface">{title}</div>
          {screen.kind === "thread" && <div className="truncate text-[11px] text-on-surface-variant">{sub(screen.other)}</div>}
        </div>
        {screen.kind === "list" && (
          <button onClick={() => setScreen({ kind: "new" })} className="btn-ghost h-7 text-[12px]">
            <Plus size={14} /> Новый
          </button>
        )}
        <button onClick={onClose} aria-label="Закрыть чат" className="btn-icon h-7 w-7">
          <X size={16} />
        </button>
      </div>
      {screen.kind === "list" && <ThreadList onOpen={(t) => setScreen({ kind: "thread", threadId: t.id, other: t.other })} onUnread={onUnread} />}
      {screen.kind === "new" && <People onPick={(p, threads) => setScreen({ kind: "thread", threadId: threads.find((t) => t.other.id === p.id)?.id ?? null, other: p })} />}
      {screen.kind === "thread" && <Thread key={screen.other.id} meId={meId} threadId={screen.threadId} other={screen.other} onUnread={onUnread} />}
    </>
  );
}

function ThreadList({ onOpen, onUnread }: { onOpen: (t: ChatThreadView) => void; onUnread: (n: number) => void }) {
  const [threads, setThreads] = useState<ChatThreadView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (document.hidden) return;
      const r = await api<{ threads: ChatThreadView[]; unreadTotal: number }>("/api/chat");
      if (stop) return;
      if (r.ok) {
        setThreads(r.data.threads);
        onUnread(r.data.unreadTotal);
        setError(null);
      } else setError(r.message);
    };
    void load();
    const t = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [onUnread]);
  if (error && !threads) return <p className="p-4 text-[13px] text-status-red">{error}</p>;
  if (!threads) return <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}</div>;
  if (threads.length === 0) return <p className="p-6 text-center text-[13px] text-on-surface-variant">Диалогов пока нет. Нажмите «Новый», чтобы написать коллеге.</p>;
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto">
      {threads.map((t) => (
        <li key={t.id}>
          <button onClick={() => onOpen(t)} className="flex w-full items-center gap-3 border-b border-outline-variant/50 px-3 py-2.5 text-left hover:bg-surface-low">
            <PersonAvatar name={t.other.name} size={36} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className={`truncate text-[13px] ${t.unread ? "font-bold" : "font-semibold"} text-on-surface`}>{t.other.name}</span>
                <span className="shrink-0 text-[11px] text-outline">{when(t.lastAt)}</span>
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] text-on-surface-variant">{t.lastMine ? "Вы: " : ""}{t.lastText ?? ""}</span>
                {t.unread > 0 && <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">{t.unread}</span>}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function People({ onPick }: { onPick: (p: ChatPersonView, threads: ChatThreadView[]) => void }) {
  const [people, setPeople] = useState<ChatPersonView[] | null>(null);
  const [threads, setThreads] = useState<ChatThreadView[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    void (async () => {
      const [p, t] = await Promise.all([api<{ people: ChatPersonView[] }>("/api/chat/people"), api<{ threads: ChatThreadView[] }>("/api/chat")]);
      setPeople(p.ok ? p.data.people : []);
      if (t.ok) setThreads(t.data.threads);
    })();
  }, []);
  const needle = q.trim().toLowerCase();
  const list = (people ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.directorateName ?? "").toLowerCase().includes(needle));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-outline-variant p-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Кому написать: имя или дирекция" className="input w-full text-[13px]" />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {people === null && <li className="p-4 text-[13px] text-on-surface-variant">Загружаю…</li>}
        {people !== null && list.length === 0 && <li className="p-4 text-[13px] text-on-surface-variant">{people.length === 0 ? "Вам пока некому писать первым: ЗГД напишет сам, ответить можно в его диалоге." : "Никого не нашли."}</li>}
        {list.map((p) => (
          <li key={p.id}>
            <button onClick={() => onPick(p, threads)} className="flex w-full items-center gap-3 border-b border-outline-variant/50 px-3 py-2 text-left hover:bg-surface-low">
              <PersonAvatar name={p.name} size={30} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-on-surface">{p.name}</span>
                <span className="block truncate text-[11px] text-on-surface-variant">{sub(p)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Thread({ meId, threadId: initialId, other, onUnread }: { meId: string; threadId: string | null; other: ChatPersonView; onUnread: (n: number) => void }) {
  const [threadId, setThreadId] = useState(initialId);
  const [detail, setDetail] = useState<ChatThreadDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [text, setText] = useState("");
  const [item, setItem] = useState<{ id: string; title: string } | null>(null);
  const [picker, setPicker] = useState(false);
  const [found, setFound] = useState<Array<{ id: string; title: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // поле растёт по тексту до 7 строк; полоса прокрутки — только когда строк больше
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
    el.style.overflowY = el.scrollHeight > 140 ? "auto" : "hidden";
  }, [text]);
  const last = useRef<string | null>(null);

  const merge = useCallback((incoming: ChatMessageView[], replace: boolean) => {
    setMessages((cur) => {
      const base = replace ? [] : cur;
      const seen = new Set(base.map((m) => m.id));
      return [...base, ...incoming.filter((m) => !seen.has(m.id))];
    });
  }, []);

  // диалог ещё не создан (первое сообщение создаст его): есть только собеседник — права смотрим в списке людей, сервер проверит сам
  useEffect(() => {
    if (!threadId) return;
    let stop = false;
    const load = async (first: boolean) => {
      if (!first && document.hidden) return;
      const qs = first || !last.current ? "?markRead=1" : `?markRead=1&since=${encodeURIComponent(last.current)}`;
      const r = await api<ChatThreadDetail>(`/api/chat/threads/${threadId}${qs}`);
      if (stop || !r.ok) {
        if (!stop && !r.ok && first) setError(r.message);
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
    void load(true);
    const t = setInterval(() => void load(false), 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [threadId, merge, onUnread]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  useEffect(() => {
    if (!picker) return;
    const t = setTimeout(async () => {
      const r = await api<{ items: Array<{ id: string; title: string }> }>(`/api/chat/items?q=${encodeURIComponent(text.startsWith("#") ? text.slice(1) : "")}`);
      if (r.ok) setFound(r.data.items);
    }, 200);
    return () => clearTimeout(t);
  }, [picker, text]);

  async function send() {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    const r = await api<{ threadId: string; message: ChatMessageView }>("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toUserId: other.id, text, itemId: item?.id ?? null }) });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setText("");
    setItem(null);
    setPicker(false);
    merge([r.data.message], false);
    last.current = r.data.message.createdAt;
    if (!threadId) setThreadId(r.data.threadId);
  }

  async function close() {
    if (!threadId) return;
    const r = await api<{ ok: true }>(`/api/chat/threads/${threadId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "close" }) });
    if (!r.ok) return setError(r.message);
    setDetail((d) => (d ? { ...d, closed: true, canClose: false, canPost: true } : d));
  }

  // новый диалог: пока сервер не создал его, писать можно — право проверит отправка (человек попал в список «кому писать» по тем же правилам)
  const canPost = threadId ? detail?.canPost ?? false : true;
  const block = threadId ? detail?.blockReason ?? null : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-surface-low/40 p-3">
        {threadId && !detail && !error && <div className="skeleton h-10 w-2/3 rounded-lg" />}
        {!threadId && <p className="py-6 text-center text-[12px] text-on-surface-variant">Диалога ещё нет. Напишите первое сообщение — {other.name} увидит его в чате.</p>}
        {messages.map((m) => {
          const mine = m.authorId === meId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-1.5 text-[13px] ${mine ? "bg-primary-soft text-on-surface" : "bg-surface-high text-on-surface"}`}>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text}</p>
                {m.item && (
                  <Link href={`/tracker?item=${m.item.id}`} className="mt-1 flex items-center gap-1 rounded-md border border-outline-variant bg-surface px-2 py-1 text-[12px] font-semibold text-primary hover:underline">
                    <Paperclip size={12} className="shrink-0" /> <span className="line-clamp-2">{m.item.title}</span>
                  </Link>
                )}
                {m.itemUnavailable && <p className="mt-1 text-[11px] italic text-outline">приложена задача, недоступная вам</p>}
                <p className="mt-0.5 text-right text-[10px] text-outline">{hm(m.createdAt)}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {error && <p className="border-t border-outline-variant px-3 py-1.5 text-[12px] text-status-red">{error}</p>}
      {detail?.canClose && threadId && (
        <div className="border-t border-outline-variant px-3 py-1.5 text-right">
          <button onClick={() => void close()} className="text-[11px] font-semibold text-on-surface-variant hover:underline" title="После закрытия руководитель сможет ответить только после вашего нового сообщения">
            Закрыть диалог
          </button>
        </div>
      )}
      {canPost ? (
        <div className="shrink-0 space-y-1.5 border-t border-outline-variant p-2">
          {picker && (
            <div className="rounded-md border border-outline-variant bg-surface">
              <p className="px-2 pt-1.5 text-[11px] text-outline">Недавние задачи; начните с «#» и название, чтобы найти</p>
              <ul className="max-h-32 overflow-y-auto">
                {found.length === 0 && <li className="px-2 py-1.5 text-[12px] text-on-surface-variant">Ничего не найдено</li>}
                {found.map((i) => (
                  <li key={i.id}>
                    <button
                      onClick={() => {
                        setItem(i);
                        setPicker(false);
                        if (text.startsWith("#")) setText("");
                      }}
                      className="block w-full truncate px-2 py-1.5 text-left text-[12px] hover:bg-surface-low"
                    >
                      {i.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {item && (
            <div className="flex items-center gap-1 rounded-md bg-primary-soft px-2 py-1 text-[12px] text-primary">
              <Paperclip size={12} /> <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <button onClick={() => setItem(null)} aria-label="Убрать задачу" className="shrink-0">
                <X size={12} />
              </button>
            </div>
          )}
          <div className="flex items-end gap-1.5">
            {other.role !== "EXECUTIVE" && (
              <button onClick={() => setPicker((p) => !p)} aria-label="Прикрепить задачу" title="Прикрепить задачу" className="btn-icon h-8 w-8 shrink-0">
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
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Сообщение… Enter — отправить"
              className="input min-h-8 flex-1 resize-none overflow-hidden py-1.5 text-[13px] leading-5"
            />
            <button onClick={() => void send()} disabled={busy || !text.trim()} aria-label="Отправить" title="Отправить" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white disabled:opacity-40">
              <Send size={15} />
            </button>
          </div>
        </div>
      ) : (
        <p className="shrink-0 border-t border-outline-variant bg-surface-low px-3 py-2.5 text-[12px] text-on-surface-variant">{block ?? "Писать этому человеку нельзя."}</p>
      )}
    </div>
  );
}
