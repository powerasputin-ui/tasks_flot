"use client";

import { fetchFirstByteRetry } from "@/lib/fetch-retry";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronDown, Plus, RefreshCw, Send, Sparkles, Square, X } from "lucide-react";

/** Анимированный шар-помощник (сжатый WebP 112×112, ~270 КБ) и его неподвижный кадр — для «уменьшить движение». */
export function OperativshchikAvatar({ size = 56, still = false }: { size?: number; still?: boolean }) {
  return (
    <picture>
      {!still && <source srcSet="/operativshchik.webp" media="(prefers-reduced-motion: no-preference)" />}
      <img src="/operativshchik-still.webp" alt="" width={size} height={size} style={{ width: size, height: size }} className="select-none rounded-full" draggable={false} />
    </picture>
  );
}

type Style = "improve" | "shorter" | "formal";
const STYLE_LABEL: Record<Style, string> = { improve: "Улучшить", shorter: "Короче", formal: "Официальнее" };

/**
 * Карточка «было → стало» для одного пункта справки. Ничего не меняет сама: текст попадает в справку только по «Заменить».
 * Открывается у кнопки ✨ на пункте или в месте правого клика.
 */
export function RewritePanel({ cycleId, text, anchor, onReplace, onClose }: { cycleId: string; text: string; anchor: { x: number; y: number }; onReplace: (t: string) => void; onClose: () => void }) {
  const [style, setStyle] = useState<Style>("improve");
  const [variant, setVariant] = useState<string | null>(null);
  const [warn, setWarn] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  async function run(s: Style) {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setStyle(s);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/ai/memo-assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cycleId, mode: "rewrite", text, style: s }), signal: c.signal });
      const d = await r.json().catch(() => null);
      if (!r.ok) return setError(d?.message ?? "Не удалось получить вариант. Попробуйте ещё раз.");
      setVariant(d.text);
      setWarn(d.newNumbers ?? []);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Связь прервалась. Попробуйте ещё раз.");
    } finally {
      if (ctl.current === c) setBusy(false);
    }
  }

  useEffect(() => {
    void run("improve");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      ctl.current?.abort();
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const W = 420;
  const left = typeof window === "undefined" ? 0 : Math.max(8, Math.min(anchor.x - W + 40, window.innerWidth - W - 8));
  const below = typeof window === "undefined" || anchor.y + 340 < window.innerHeight;
  const mobile = typeof window !== "undefined" && window.innerWidth < 768;

  const card = (
    <div
      className={`animate-fade-in fixed z-[90] overflow-hidden border border-outline-variant bg-surface shadow-2xl ${mobile ? "inset-x-0 bottom-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]" : "rounded-xl"}`}
      style={mobile ? undefined : { left, top: below ? anchor.y + 10 : undefined, bottom: below ? undefined : window.innerHeight - anchor.y + 10, width: W }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-outline-variant px-3.5 py-2.5">
        <OperativshchikAvatar size={26} />
        <span className="flex-1 text-[13px] font-semibold text-on-surface">Оперативщик: другая формулировка</span>
        <button onClick={onClose} className="btn-icon h-7 w-7" aria-label="Закрыть"><X size={15} /></button>
      </div>
      <div className="space-y-2.5 p-3.5">
        <div>
          <p className="label-caps mb-1">Было</p>
          <p className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-md bg-surface-low px-2.5 py-1.5 text-[13px] leading-snug text-on-surface-variant [overflow-wrap:anywhere]">{text}</p>
        </div>
        <div>
          <p className="label-caps mb-1">Стало</p>
          <div className="min-h-[64px] whitespace-pre-wrap rounded-md border border-primary/40 bg-primary-soft/40 px-2.5 py-1.5 text-[13px] leading-snug text-on-surface [overflow-wrap:anywhere]">
            {busy ? <span className="text-on-surface-variant">Думаю над формулировкой…</span> : error ? <span className="text-status-red">{error}</span> : variant}
          </div>
          {!busy && warn.length > 0 && (
            <p className="mt-1 flex items-start gap-1 text-[11px] text-status-amber">
              <AlertTriangle size={13} className="mt-px shrink-0" /> Появились числа, которых не было в пункте: {warn.join(", ")} — проверьте перед заменой.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(STYLE_LABEL) as Style[]).map((s) => (
            <button key={s} onClick={() => void run(s)} disabled={busy} className={`rounded-full border px-2.5 py-1 text-[12px] disabled:opacity-50 ${style === s ? "border-primary bg-primary-soft font-semibold text-primary" : "border-outline-variant text-on-surface hover:bg-surface-high"}`}>
              {STYLE_LABEL[s]}
            </button>
          ))}
          <button onClick={() => void run(style)} disabled={busy} className="ml-auto flex items-center gap-1 text-[12px] font-semibold text-primary disabled:opacity-50" title="Ещё один вариант">
            <RefreshCw size={13} /> Ещё вариант
          </button>
        </div>
        <div className="flex gap-2 pt-0.5">
          <button onClick={() => variant && onReplace(variant)} disabled={busy || !variant || !!error} className="btn-primary h-9 flex-1">
            <Check size={15} /> Заменить
          </button>
          <button onClick={onClose} className="btn-ghost h-9">Отмена</button>
        </div>
        <p className="text-[11px] leading-snug text-outline">Помощник не добавляет фактов — только перестраивает текст. Проверьте цифры и даты.</p>
      </div>
    </div>
  );
  return createPortal(
    <>
      <div className="fixed inset-0 z-[89]" onMouseDown={onClose} />
      {card}
    </>,
    document.body
  );
}

type Msg = { role: "user" | "assistant"; content: string };
const QUICK = ["Проверь справку: где формулировки слабые", "Приведи пункты к одному стилю", "Что в справке будет непонятно руководству?"];

/** «Оперативщик» в правом нижнем углу справки: клик — маленький чат по текущему черновику. */
export function Operativshchik({ cycleId, disabledReason }: { cycleId: string; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy || disabledReason) return;
    const history: Msg[] = [...messages, { role: "user", content: q }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const r = await fetchFirstByteRetry("/api/ai/memo-assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cycleId, mode: "chat", messages: history }), signal: ctl.signal }, 45000);
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => null);
        setError(d?.message ?? "Не удалось получить ответ.");
        setMessages(history);
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: acc }]);
      }
      if (!acc.trim()) {
        setError("ИИ вернул пустой ответ.");
        setMessages(history);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError("Связь прервалась. Попробуйте ещё раз.");
        setMessages(history);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2 max-md:bottom-[calc(4.2rem+env(safe-area-inset-bottom))] max-md:right-3">
      {open && (
        <div className="animate-fade-in flex h-[480px] max-h-[70vh] w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-outline-variant bg-surface shadow-2xl">
          <div className="flex items-center gap-2 border-b border-outline-variant px-3 py-2">
            <OperativshchikAvatar size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-on-surface">Оперативщик</p>
              <p className="truncate text-[11px] text-on-surface-variant">помогаю с текстом справки</p>
            </div>
            {messages.length > 0 && (
              <button onClick={() => { abort.current?.abort(); setMessages([]); setError(null); }} className="btn-icon h-7 w-7" title="Новый разговор" aria-label="Новый разговор">
                <Plus size={15} />
              </button>
            )}
            <button onClick={() => setOpen(false)} className="btn-icon h-7 w-7" title="Свернуть" aria-label="Свернуть">
              <ChevronDown size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
            <div className="rounded-2xl bg-surface-low px-3 py-2 text-[13px] leading-relaxed text-on-surface">
              Привет, я твой Оперативщик! Помогу сделать справку понятной и ровной: подскажу слабые формулировки, приведу пункты к одному стилю.
              Чтобы переписать один пункт — наведите на него и нажмите <Sparkles size={12} className="inline" /> или правую кнопку.
            </div>
            {messages.length === 0 && (
              <div className="flex flex-col items-start gap-1.5">
                {QUICK.map((q) => (
                  <button key={q} onClick={() => void ask(q)} disabled={!!disabledReason} className="rounded-full border border-outline-variant px-3 py-1 text-left text-[12px] text-on-surface hover:bg-surface-high disabled:opacity-50">
                    {q}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed [overflow-wrap:anywhere] ${m.role === "user" ? "bg-primary text-white" : "bg-surface-low text-on-surface"}`}>
                  {m.content || (busy && i === messages.length - 1 ? <span className="text-on-surface-variant">Думаю…</span> : "")}
                </div>
              </div>
            ))}
            {error && <p className="text-[12px] text-status-red">{error}</p>}
            <div ref={bottom} />
          </div>
          <form
            className="flex items-end gap-1.5 border-t border-outline-variant p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(input);
                }
              }}
              rows={1}
              placeholder={disabledReason ? "Недоступно в режиме просмотра" : "Спроси меня…"}
              disabled={!!disabledReason}
              className="input max-h-28 min-h-[38px] flex-1 resize-none overflow-hidden py-2 leading-snug [scrollbar-width:none]"
            />
            {busy ? (
              <button type="button" onClick={() => abort.current?.abort()} className="btn-icon h-9 w-9" aria-label="Остановить"><Square size={15} /></button>
            ) : (
              <button type="submit" disabled={!input.trim() || !!disabledReason} className="btn-primary h-9 w-9 px-0" aria-label="Отправить"><Send size={15} /></button>
            )}
          </form>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="group relative rounded-full shadow-lg ring-2 ring-white/70 transition-transform hover:scale-105 active:scale-95"
        title={open ? "Свернуть Оперативщика" : "Оперативщик — помощник по тексту справки"}
        aria-label="Оперативщик"
      >
        <OperativshchikAvatar size={56} />
        {!open && messages.length === 0 && (
          <span className="pointer-events-none absolute right-[64px] top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-full bg-surface px-3 py-1 text-[12px] font-semibold text-on-surface shadow-md group-hover:block">
            Привет! Я Оперативщик
          </span>
        )}
      </button>
    </div>
  );
}
