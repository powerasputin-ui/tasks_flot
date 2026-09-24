"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

type Provider = "openai" | "anthropic";
type Defaults = Record<Provider, { baseUrl: string; model: string }>;
type State = { configured: boolean; provider?: Provider; baseUrl?: string; model?: string; keyHint?: string; defaults: Defaults };

const FALLBACK: Defaults = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
};

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

  useEffect(() => {
    fetch("/api/ai/settings")
      .then((r) => r.json())
      .then((s: State) => {
        setState(s);
        if (s.configured && s.provider) {
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
    onChanged(false);
    close();
  }

  const canTest = !!apiKey.trim() || !!state?.configured;

  return (
    <div className="space-y-3 p-4">
      <div>
        <p className="text-[13px] font-semibold text-on-surface">Подключение ИИ</p>
        <p className="mt-0.5 text-[12px] leading-snug text-on-surface-variant">Вставьте ключ API любого провайдера. Ключ хранится на сервере в зашифрованном виде и в браузер не возвращается.</p>
      </div>

      <label className="block text-[12px] text-on-surface-variant">
        Тип подключения
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as Provider);
            setBaseUrl("");
            setModel("");
          }}
          className="select mt-1 w-full"
        >
          <option value="openai">OpenAI-совместимый (OpenAI, DeepSeek, OpenRouter, Ollama…)</option>
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
        Ключ API {state?.configured && <span className="text-on-surface">· сохранён {state.keyHint}</span>}
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          placeholder={state?.configured ? "Оставьте пустым, чтобы не менять" : "sk-…"}
          className="input mt-1 w-full"
        />
      </label>

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
        <button onClick={() => void call("save")} disabled={(!apiKey.trim() && !state?.configured) || busy !== null} className="btn-primary h-8">
          {busy === "save" && <Loader2 size={14} className="animate-spin" />} Сохранить
        </button>
        {state?.configured && (
          <button onClick={() => void disconnect()} className="ml-auto text-[12px] font-semibold text-status-red hover:underline">
            Отключить
          </button>
        )}
      </div>
    </div>
  );
}
