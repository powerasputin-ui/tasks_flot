"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

type Provider = "openai" | "anthropic";
type Defaults = Record<Provider, { baseUrl: string; model: string }>;
type Shared = { model: string; host: string; fallback: { model: string; host: string } | null } | null;
type State = { configured: boolean; own?: boolean; shared?: Shared; provider?: Provider; baseUrl?: string; model?: string; keyHint?: string; defaults: Defaults };

const providerName = (host: string) => (host.includes("groq") ? "Groq" : host.includes("nvidia") ? "NVIDIA" : host.includes("googleapis") ? "Google" : host.includes("openrouter") ? "OpenRouter" : host);

const FALLBACK: Defaults = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
};

/** Готовые бесплатные варианты для теста: адрес и модель подставляются, ключ человек получает у провайдера сам. */
const PRESETS: Array<{ id: string; label: string; baseUrl: string; model: string; keyUrl: string; note: string }> = [
  {
    id: "groq-gptoss",
    label: "Groq · GPT-OSS 120B (бесплатно, рекомендую)",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    keyUrl: "https://console.groq.com/keys",
    note: "Проверено: лучший бесплатный вариант для чата по справкам, ключ бессрочный. Лимит ~8 тыс. токенов в минуту: справки сжимаются до ≈11 тыс. символов (3–5 страниц) — сначала без строк-источников, затем обрезка; об этом пишется под ответом. Для сводки по нескольким дирекциям лучше NVIDIA. Ключ начинается с gsk_.",
  },
  {
    id: "groq-gptoss-20b",
    label: "Groq · GPT-OSS 20B (бесплатно, быстрее)",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-20b",
    keyUrl: "https://console.groq.com/keys",
    note: "Запасной вариант на том же ключе Groq: быстрее, но слабее. Те же лимиты и сжатие справок.",
  },
  {
    id: "nvidia-nemotron",
    label: "NVIDIA · Nemotron 3 Super (бесплатно)",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "nvidia/nemotron-3-super-120b-a12b",
    keyUrl: "https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b",
    note: "Проверено: большое окно — справки нескольких дирекций целиком, сводка ~15 с. Бесплатно ~40 запросов в минуту; NVIDIA просит не отправлять конфиденциальные данные. Ключ начинается с nvapi-.",
  },
  {
    id: "gemini",
    label: "Google Gemini · 3.5 Flash (бесплатно)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.5-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    note: "Сильный и с большим контекстом. На бесплатном тарифе Google может использовать запросы для обучения — только для неважных справок.",
  },
];

/**
 * Подключение ИИ: тип, адрес, модель, ключ → «Проверить связь» → «Сохранить».
 * Ключ уходит только на сервер приложения и обратно не возвращается — после сохранения виден лишь его конец.
 */
export function AiSettingsPanel({ onChanged, close }: { onChanged: (configured: boolean) => void; close: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [provider, setProvider] = useState<Provider>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [preset, setPreset] = useState("");
  // при общем подключении своя форма не нужна — открывается по ссылке
  const [ownOpen, setOwnOpen] = useState(false);
  const chosen = PRESETS.find((x) => x.id === preset);

  useEffect(() => {
    fetch("/api/ai/settings")
      .then((r) => r.json())
      .then((s: State) => {
        setState(s);
        if (s.own && s.provider) {
          setProvider(s.provider);
          setBaseUrl(s.baseUrl ?? "");
          setModel(s.model ?? "");
        }
      })
      .catch(() => setResult({ ok: false, text: "Не удалось загрузить настройки." }));
  }, []);

  const defaults = state?.defaults ?? FALLBACK;
  const body = () => JSON.stringify({ provider, baseUrl, model, apiKey });

  async function call(kind: "test" | "save") {
    setBusy(kind);
    setResult(null);
    try {
      const r = await fetch(kind === "test" ? "/api/ai/settings/test" : "/api/ai/settings", { method: kind === "test" ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: body() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setResult({ ok: false, text: d.message ?? "Не удалось выполнить." });
        return;
      }
      if (kind === "test") setResult({ ok: true, text: `Связь есть · модель ${d.model} · ${(d.ms / 1000).toFixed(1)} с` });
      else {
        onChanged(true);
        close();
      }
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    await fetch("/api/ai/settings", { method: "DELETE" });
    onChanged(!!state?.shared); // свой ключ убран — остаётся общее подключение, если оно есть
    close();
  }

  const own = !!state?.own;
  const shared = state?.shared ?? null;
  const canTest = !!apiKey.trim() || own;

  return (
    <div className="space-y-3 p-4">
      <div>
        <p className="text-[13px] font-semibold text-on-surface">Подключение ИИ</p>
        {shared && !own ? (
          <div className="mt-1.5 rounded-md bg-status-emerald/10 px-3 py-2 text-[12px] leading-snug text-on-surface">
            <p className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 size={14} className="text-status-emerald" /> ИИ уже подключён для всех — ничего настраивать не нужно.
            </p>
            <p className="mt-1 text-on-surface-variant">
              Модель: {providerName(shared.host)} · {shared.model}
              {shared.fallback && <>; если она занята или справки не помещаются — {providerName(shared.fallback.host)} · {shared.fallback.model}</>}.
            </p>
          </div>
        ) : (
          <p className="mt-0.5 text-[12px] leading-snug text-on-surface-variant">Вставьте ключ API любого провайдера. Ключ хранится на сервере в зашифрованном виде и в браузер не возвращается.</p>
        )}
      </div>

      {shared && !own && !ownOpen ? (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => void call("test")} disabled={busy !== null} className="btn-ghost h-8">
            {busy === "test" && <Loader2 size={14} className="animate-spin" />} Проверить связь
          </button>
          <button onClick={() => setOwnOpen(true)} className="text-[12px] text-on-surface-variant hover:text-on-surface hover:underline">
            Использовать свой ключ (необязательно)
          </button>
          {result && (
            <p className={`flex w-full items-start gap-1.5 text-[12px] leading-snug ${result.ok ? "text-status-emerald" : "text-status-red"}`}>
              {result.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
              {result.text}
            </p>
          )}
        </div>
      ) : (
        <>
      <label className="block text-[12px] text-on-surface-variant">
        Готовый вариант
        <select
          value={preset}
          onChange={(e) => {
            const p = PRESETS.find((x) => x.id === e.target.value);
            setPreset(e.target.value);
            if (p) {
              setProvider("openai");
              setBaseUrl(p.baseUrl);
              setModel(p.model);
            }
          }}
          className="select mt-1 w-full"
        >
          <option value="">Свои настройки</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {chosen && (
        <p className="rounded-md bg-surface-high px-3 py-2 text-[12px] leading-snug text-on-surface-variant">
          {chosen.note}{" "}
          <a href={chosen.keyUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
            Получить ключ
          </a>
        </p>
      )}

      <label className="block text-[12px] text-on-surface-variant">
        Тип подключения
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as Provider);
            setPreset("");
            setBaseUrl("");
            setModel("");
          }}
          className="select mt-1 w-full"
        >
          <option value="openai">OpenAI-совместимый (OpenAI, NVIDIA, Groq, Gemini, OpenRouter…)</option>
          <option value="anthropic">Anthropic (Claude)</option>
        </select>
      </label>
      <label className="block text-[12px] text-on-surface-variant">
        Адрес API
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={defaults[provider].baseUrl} className="input mt-1 w-full" />
      </label>
      <label className="block text-[12px] text-on-surface-variant">
        Модель
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={defaults[provider].model} className="input mt-1 w-full" />
      </label>
      <label className="block text-[12px] text-on-surface-variant">
        Ключ API {own && <span className="text-on-surface">· сохранён {state?.keyHint}</span>}
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          placeholder={own ? "Оставьте пустым, чтобы не менять" : chosen?.id.startsWith("nvidia") ? "nvapi-…" : chosen?.id.startsWith("groq") ? "gsk_…" : "Ключ API"}
          className="input mt-1 w-full"
        />
      </label>

      {/groq\.com/i.test(baseUrl) && !chosen && (
        <p className="rounded-md bg-status-amber/10 px-3 py-2 text-[12px] leading-snug text-on-surface">
          Бесплатный Groq принимает ~8 тыс. токенов в минуту: справки будут сжиматься (сначала без строк-источников, потом обрезаться), ответы — короче.
        </p>
      )}

      {result && (
        <p className={`flex items-start gap-1.5 text-[12px] leading-snug ${result.ok ? "text-status-emerald" : "text-status-red"}`}>
          {result.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
          {result.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void call("test")} disabled={!canTest || busy !== null} className="btn-ghost h-8">
          {busy === "test" && <Loader2 size={14} className="animate-spin" />} Проверить связь
        </button>
        <button onClick={() => void call("save")} disabled={(!apiKey.trim() && !own) || busy !== null} className="btn-primary h-8">
          {busy === "save" && <Loader2 size={14} className="animate-spin" />} Сохранить
        </button>
        {own && (
          <button onClick={() => void disconnect()} className="ml-auto text-[12px] font-semibold text-status-red hover:underline">
            {state?.shared ? "Убрать свой ключ" : "Отключить"}
          </button>
        )}
      </div>
        </>
      )}
    </div>
  );
}
