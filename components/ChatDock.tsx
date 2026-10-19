"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, MessageSquare, Plus, X } from "lucide-react";
import { useIsMobile } from "@/lib/use-mobile";
import { api, ThreadAvatar, when } from "@/components/chat/shared";
import { NewChat } from "@/components/chat/NewChat";
import { Thread } from "@/components/chat/Thread";
import type { ChatPersonView, ChatThreadView } from "@/lib/chat-server";

const POS_KEY = "operativka.chat.pos.v2";

type Screen = { kind: "list" } | { kind: "new" } | { kind: "thread"; threadId: string | null; other: ChatPersonView | null };

const BALL = 56;
const GAP = 12;
const W = 384; // 24rem
const H = 544; // 34rem

/**
 * Чат — круглая кнопка того же размера, что шар «Оперативщика»: перетаскивается куда угодно (место запоминается, двойной щелчок —
 * вернуть), щелчок открывает и сворачивает окно. Если на странице есть шар Оперативщика, кнопка чата стоит над ним (как в Facebook) —
 * пока человек не поставил её сам. Окно раскрывается рядом с кнопкой; на телефоне — на весь экран.
 * Открыть чат из другого места: событие «chat:open» ({ threadId } или { other }) или параметр адреса ?chat=<id> (ссылка из уведомления).
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
  // левый край открытой справа панели (карточка задачи, поручение…): кнопка не должна закрывать её поля и кнопки
  const [panelLeft, setPanelLeft] = useState<number | null>(null);
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

  // место по умолчанию: над шаром Оперативщика, если он на странице, иначе правый нижний угол (на телефоне — над нижней панелью);
  // заодно — ссылка из уведомления ?chat=<id>: открыть окно на этом диалоге и убрать параметр из адреса
  useEffect(() => {
    const place = () => {
      const ai = document.querySelector("[data-ai-ball]")?.getBoundingClientRect();
      const next = ai && ai.width > 0 ? clamp(ai.left, ai.top - BALL - GAP) : clamp(window.innerWidth - BALL - 20, window.innerHeight - BALL - (window.innerWidth < 768 ? 80 : 20));
      setBase((b) => (b.x === next.x && b.y === next.y ? b : next));
      const panel = document.querySelector("[data-side-panel]")?.getBoundingClientRect();
      const left = panel && panel.width > 0 ? Math.round(panel.left) : null;
      setPanelLeft((l) => (l === left ? l : left));
      const url = new URL(window.location.href);
      const id = url.searchParams.get("chat");
      if (id) {
        url.searchParams.delete("chat");
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
        setOpen(true);
        setScreen({ kind: "thread", threadId: id, other: null });
      }
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
      const d = (e as CustomEvent<{ other?: ChatPersonView; threadId?: string }>).detail;
      setOpen(true);
      setScreen(d?.threadId ? { kind: "thread", threadId: d.threadId, other: null } : d?.other ? { kind: "thread", threadId: null, other: d.other } : { kind: "list" });
    };
    window.addEventListener("chat:open", onOpen);
    return () => window.removeEventListener("chat:open", onOpen);
  }, []);

  if (!mounted || typeof document === "undefined") return null;
  const placed = dragPos ?? (saved ? clamp(saved.x, saved.y) : base);
  // открыта панель справа и кнопка на неё заходит — отступает левее панели; места слева нет (телефон, панель на весь экран) — прячется,
  // пока панель открыта (в карточке задачи есть «Обсудить»). Пока человек тащит кнопку — она под его пальцем.
  const overPanel = !dragPos && panelLeft !== null && placed.x + BALL > panelLeft;
  const hidden = overPanel && !open && panelLeft! < BALL + 2 * GAP;
  const pos = overPanel && !hidden ? { x: Math.max(8, panelLeft! - BALL - GAP), y: placed.y } : placed;
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
      {!(open && mobile) && !hidden && (
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
          onClick={(e) => {
            // щелчок мышью и касание обрабатывает pointerup (там же перетаскивание); сюда доходит только клавиатура
            if (e.detail === 0) setOpen((o) => !o);
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
  const toList = useCallback(() => setScreen({ kind: "list" }), [setScreen]);
  if (screen.kind === "thread") return <Thread key={screen.threadId ?? screen.other?.id ?? "new"} meId={meId} threadId={screen.threadId} other={screen.other} onUnread={onUnread} onBack={toList} onClose={onClose} />;
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant bg-surface-low px-3 py-2.5">
        {screen.kind === "new" && (
          <button onClick={toList} aria-label="К списку диалогов" className="btn-icon h-7 w-7">
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="min-w-0 flex-1 truncate text-[13px] font-bold text-on-surface">{screen.kind === "new" ? "Новый чат" : "Чат"}</div>
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
      {screen.kind === "new" && <NewChat onDirect={(p, threads) => setScreen({ kind: "thread", threadId: threads.find((t) => t.kind === "DIRECT" && t.other?.id === p.id)?.id ?? null, other: p })} onGroup={(id) => setScreen({ kind: "thread", threadId: id, other: null })} />}
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
  if (threads.length === 0) return <p className="p-6 text-center text-[13px] text-on-surface-variant">Диалогов пока нет. Нажмите «Новый», чтобы написать коллеге или создать группу.</p>;
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto">
      {threads.map((t) => (
        <li key={t.id}>
          <button onClick={() => onOpen(t)} className="flex w-full items-center gap-3 border-b border-outline-variant/50 px-3 py-2.5 text-left hover:bg-surface-low">
            <ThreadAvatar t={t} size={36} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className={`truncate text-[13px] ${t.unread ? "font-bold" : "font-semibold"} text-on-surface`}>{t.kind === "DIRECT" ? t.other?.name : t.title}</span>
                <span className="shrink-0 text-[11px] text-outline">{when(t.lastAt)}</span>
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] text-on-surface-variant">
                  {t.kind !== "DIRECT" && (
                    <span className="text-outline">
                      {t.kind === "TASK" ? "задача · " : ""}
                      {t.memberCount} уч. ·{" "}
                    </span>
                  )}
                  {t.lastMine ? "Вы: " : ""}
                  {t.lastText ?? ""}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {t.mention && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-status-red px-1 text-[10px] font-bold text-white" title="Вас упомянули">
                      @
                    </span>
                  )}
                  {t.unread > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">{t.unread}</span>}
                </span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
