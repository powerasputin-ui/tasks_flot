"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, Plus, Send, Settings2, Square } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import { AiSettingsPanel } from "@/components/AiSettingsPanel";

type Msg = { role: "user" | "assistant"; content: string };

const QUICK = ["Сделай выжимку: главное коротко", "Что просит решения или помощи?", "Какие риски и сдвинутые сроки?", "Что не сделано или зависло?"];

/**
 * Чат-помощник ЗГД внизу страницы, как в ChatGPT: отвечает по открытой справке (или по справкам, отмеченным в «Сводке»).
 * Тексты справок с браузера не уходят: отправляются только id справок и вопросы, остальное собирает сервер.
 */
export function AiChat({ versionIds, scopeLabel, disabledReason }: { versionIds: string[]; scopeLabel: string; disabledReason?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/ai/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setConfigured(!!s?.configured))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);

  // другая справка — другой разговор
  const key = versionIds.join(",");
  useEffect(() => {
    abort.current?.abort();
    setMessages([]);
    setError(null);
  }, [key]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history: Msg[] = [...messages, { role: "user", content: q }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setOpen(true);
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionIds, messages: history }), signal: ctl.signal });
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => null);
        if (d?.error === "NOT_CONFIGURED") setConfigured(false);
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

  const hasContext = !disabledReason; // без открытой справки сервер берёт последние справки дирекций
  const placeholder = disabledReason ? disabledReason : configured === false ? "Подключите ИИ (шестерёнка справа), затем спросите про справки…" : `Спросите про: ${scopeLabel}`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-3">
      <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-outline-variant bg-surface shadow-xl">
        {open && (
          <div className="flex max-h-[45vh] flex-col border-b border-outline-variant">
            <div className="flex items-center justify-between px-4 pt-2.5">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-on-surface-variant">
                <Bot size={14} /> Помощник · {scopeLabel}
              </span>
              <span className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button onClick={() => { abort.current?.abort(); setMessages([]); setError(null); }} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-on-surface-variant hover:bg-surface-high">
                    <Plus size={12} /> Новый диалог
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant hover:bg-surface-high" aria-label="Свернуть">
                  <ChevronDown size={15} />
                </button>
              </span>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {messages.length === 0 && (
                <div className="flex flex-wrap gap-2">
                  {QUICK.map((q) => (
                    <button key={q} onClick={() => void ask(q)} disabled={!hasContext} className="rounded-full border border-outline-variant px-3 py-1 text-[12px] text-on-surface hover:bg-surface-high disabled:opacity-50">
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${m.role === "user" ? "bg-primary text-white" : "bg-surface-low text-on-surface"}`}>
                    {m.content || (busy && i === messages.length - 1 ? <span className="text-on-surface-variant">Думаю…</span> : "")}
                  </div>
                </div>
              ))}
              {error && <p className="text-[12px] text-status-red">{error}</p>}
              <div ref={bottom} />
            </div>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
          className="flex items-center gap-2 px-3 py-2"
        >
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-primary-soft" title="Помощник" aria-label="Помощник">
            <Bot size={18} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            maxLength={4000}
            aria-label="Вопрос помощнику"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-on-surface outline-none placeholder:text-outline"
          />
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-high text-on-surface" title="Остановить" aria-label="Остановить">
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() || !hasContext} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white disabled:opacity-40" title="Отправить" aria-label="Отправить">
              <Send size={15} />
            </button>
          )}
          <Popover
            direction="up"
            align="right"
            width={380}
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-high" title="Подключение ИИ" aria-label="Подключение ИИ">
                <Settings2 size={16} />
                {configured === false && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-status-amber" />}
              </button>
            )}
          >
            {(close) => <AiSettingsPanel onChanged={setConfigured} close={close} />}
          </Popover>
        </form>
      </div>
    </div>
  );
}
