"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover } from "@/components/ui/Popover";

export type AiEngine = "auto" | "primary" | "fallback";
type Shared = { model: string; host: string; fallback: { model: string; host: string } | null } | null;

const STORE = "ai-engine";
const EVENT = "ai-engine-change"; // выбор в настройках и в строке чата — один и тот же
const provider = (host: string) => (host.includes("groq") ? "Groq" : host.includes("nvidia") ? "NVIDIA" : host);
const short = (model: string) => model.split("/").pop() ?? model;

/** Выбранная модель (запоминается в браузере) и что доступно в общем подключении. */
export function useAiEngine(): { engine: AiEngine; setEngine: (e: AiEngine) => void; shared: Shared; own: boolean; configured: boolean | null } {
  const [engine, setEngineState] = useState<AiEngine>("auto");
  const [shared, setShared] = useState<Shared>(null);
  const [own, setOwn] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORE);
      if (v === "primary" || v === "fallback") setEngineState(v);
    } catch {
      /* хранилище недоступно — остаётся «Авто» */
    }
    fetch("/api/ai/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        setShared(s?.shared ?? null);
        setOwn(!!s?.own);
        setConfigured(!!s?.configured);
      })
      .catch(() => setConfigured(false));
    const sync = (ev: Event) => setEngineState((ev as CustomEvent<AiEngine>).detail);
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const setEngine = (e: AiEngine) => {
    setEngineState(e);
    try {
      localStorage.setItem(STORE, e);
    } catch {
      /* не запомнится — не страшно */
    }
    window.dispatchEvent(new CustomEvent<AiEngine>(EVENT, { detail: e }));
  };
  return { engine, setEngine, shared, own, configured };
}

export function engineOptions(shared: NonNullable<Shared>): Array<{ id: AiEngine; title: string; hint: string }> {
  return [
    { id: "auto", title: "Авто", hint: `${provider(shared.host)} — быстро; большие справки и сбои — ${shared.fallback ? provider(shared.fallback.host) : "—"}` },
    { id: "primary", title: `${provider(shared.host)} · ${short(shared.model)}`, hint: "Быстрая. Окно небольшое: длинные справки сжимаются" },
    ...(shared.fallback ? [{ id: "fallback" as const, title: `${provider(shared.fallback.host)} · ${short(shared.fallback.model)}`, hint: "Большое окно: справки нескольких дирекций целиком, медленнее" }] : []),
  ];
}

/** Выбор модели списком — для окна настроек. */
export function AiModelChoice({ shared }: { shared: NonNullable<Shared> }) {
  const { engine, setEngine } = useAiEngine();
  return (
    <div role="radiogroup" aria-label="Модель ИИ" className="space-y-1">
      {engineOptions(shared).map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === engine}
          onClick={() => setEngine(o.id)}
          className={`flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left ${o.id === engine ? "border-primary bg-primary-soft" : "border-outline-variant hover:bg-surface-high"}`}
        >
          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${o.id === engine ? "border-primary" : "border-outline"}`}>
            {o.id === engine && <span className="h-2 w-2 rounded-full bg-primary" />}
          </span>
          <span className="min-w-0">
            <span className={`block text-[13px] ${o.id === engine ? "font-semibold text-primary" : "text-on-surface"}`}>{o.title}</span>
            <span className="block text-[11px] leading-snug text-on-surface-variant">{o.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Переключатель модели, как в чате Claude: «Авто», основная или запасная модель общего подключения. */
export function AiModelPicker({ engine, onChange, shared, own }: { engine: AiEngine; onChange: (e: AiEngine) => void; shared: Shared; own: boolean }) {
  if (own || !shared) return null; // со своим ключом работает его модель — выбирать нечего
  const options = engineOptions(shared);
  const current = options.find((o) => o.id === engine) ?? options[0];
  return (
    <Popover
      direction="up"
      align="right"
      width={320}
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} className="flex h-8 max-w-44 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-high" title="Модель ИИ">
          <span className="truncate">{current.title}</span>
          <ChevronDown size={13} className="shrink-0" />
        </button>
      )}
    >
      {(close) => (
        <div className="py-1">
          <p className="label-caps px-3.5 pb-1 pt-1.5">Модель</p>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onChange(o.id);
                close();
              }}
              className="flex w-full items-start gap-2.5 px-3.5 py-2 text-left hover:bg-primary-soft"
            >
              <span className="mt-0.5 w-4 shrink-0 text-primary">{o.id === engine && <Check size={14} strokeWidth={3} />}</span>
              <span className="min-w-0">
                <span className={`block text-[13px] ${o.id === engine ? "font-semibold text-primary" : "text-on-surface"}`}>{o.title}</span>
                <span className="block text-[11px] leading-snug text-on-surface-variant">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
