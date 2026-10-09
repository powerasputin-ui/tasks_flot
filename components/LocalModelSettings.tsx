"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Cpu, HardDrive, Loader2, XCircle } from "lucide-react";
import { canRememberFile, devicePref, forgetLocalModel, localModelMeta, onLocalModelChange, pickLocalModel, setDevicePref, testLocalModel, type DevicePref, type LocalModelMeta } from "@/lib/local-ai";

const ENGINE_KEY = "ai-engine";

/** Какую модель скачать — по компьютеру. Все — .gguf до ~3 ГБ (больше в память браузера не помещается). */
const MODELS: Array<{ pc: string; name: string; file: string; size: string; url: string }> = [
  { pc: "Ноутбук с видеокартой NVIDIA (Legion и т. п.)", name: "Qwen3-4B-Instruct-2507", file: "Q4_K_M", size: "2,3 ГБ", url: "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF" },
  { pc: "Офисный ноутбук (i7, 16 ГБ) — рекомендую", name: "Qwen3-1.7B", file: "Q4_K_M", size: "1,0 ГБ", url: "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF" },
  { pc: "Офисный ноутбук — быстрее, но проще", name: "Qwen2.5-1.5B-Instruct", file: "q4_k_m", size: "1,0 ГБ", url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF" },
  { pc: "Самый слабый компьютер, для пробы", name: "Qwen2.5-0.5B-Instruct", file: "q4_k_m", size: "0,5 ГБ", url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF" },
];

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1).replace(".", ",")} ГБ`;

function setEngine(e: "local" | "auto") {
  try {
    localStorage.setItem(ENGINE_KEY, e);
  } catch {
    /* не запомнится — не страшно */
  }
  window.dispatchEvent(new CustomEvent("ai-engine-change", { detail: e }));
}

/**
 * «Использовать локальную модель» в окне «Подключение ИИ»: модель с флешки или общего диска работает в браузере этого
 * компьютера (lib/local-ai.ts). Выбор хранится только в этом браузере — у других людей ничего не меняется.
 */
export function LocalModelSettings() {
  const [meta, setMeta] = useState<LocalModelMeta | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"pick" | "test" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [onCpu, setOnCpu] = useState(false);
  const [help, setHelp] = useState(false);
  const [dev, setDev] = useState<DevicePref>("auto");

  useEffect(() => {
    setMeta(localModelMeta());
    setDev(devicePref());
    return onLocalModelChange(() => {
      setMeta(localModelMeta());
      setDev(devicePref());
    });
  }, []);

  async function pick() {
    setBusy("pick");
    setResult(null);
    const err = await pickLocalModel();
    setBusy(null);
    if (err) return setResult({ ok: false, text: err });
    if (err === null) {
      setEngine("local");
      setResult({ ok: true, text: "Модель выбрана — чаты теперь отвечают ей. Нажмите «Проверить», чтобы узнать скорость." });
    }
  }

  async function test() {
    setBusy("test");
    setResult(null);
    try {
      const r = await testLocalModel(setStatus);
      setOnCpu(r.device === "cpu");
      setResult({ ok: true, text: `Работает · ${r.device === "gpu" ? "на видеокарте" : "на процессоре"} · ~${String(r.wordsPerSec).replace(".", ",")} слов/с${r.text ? ` · «${r.text.slice(0, 80)}»` : ""}` });
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message || "Модель не запустилась." });
    } finally {
      setStatus(null);
      setBusy(null);
    }
  }

  async function off() {
    await forgetLocalModel();
    setResult(null);
    setOpen(false);
  }

  if (!meta && !open)
    return (
      <button onClick={() => setOpen(true)} className="block text-[12px] text-on-surface-variant hover:text-on-surface hover:underline">
        Использовать локальную модель (на этом компьютере)
      </button>
    );

  return (
    <div className="space-y-2 rounded-md border border-outline-variant px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-on-surface">
        <HardDrive size={14} /> Локальная модель
      </p>
      <p className="text-[12px] leading-snug text-on-surface-variant">
        Модель с флешки или общего диска работает прямо в браузере этого компьютера — ничего не устанавливается, справки не уходят в облако. Есть видеокарта — считает она, нет — процессор (медленнее).
      </p>

      {meta ? (
        <p className="flex items-center gap-1.5 text-[12px] text-on-surface">
          <Cpu size={13} className="shrink-0 text-on-surface-variant" />
          <span className="truncate font-semibold">{meta.name}</span>
          <span className="shrink-0 text-on-surface-variant">· {gb(meta.size)}{meta.files > 1 ? ` · ${meta.files} части` : ""}</span>
        </p>
      ) : null}
      {meta && (
        <label className="flex items-center gap-2 text-[12px] text-on-surface-variant">
          <span className="shrink-0">Считать на</span>
          <select
            value={dev}
            onChange={(e) => {
              setResult(null);
              void setDevicePref(e.target.value as DevicePref);
            }}
            disabled={busy !== null}
            className="input h-7 min-w-0 flex-1 py-0 text-[12px]"
          >
            <option value="auto">Авто</option>
            <option value="gpu">Видеокарте</option>
            <option value="cpu">Процессоре</option>
          </select>
        </label>
      )}

      {status && <p className="flex items-center gap-1.5 text-[12px] text-on-surface-variant"><Loader2 size={13} className="animate-spin" /> {status}</p>}
      {result && (
        <p className={`flex items-start gap-1.5 text-[12px] leading-snug ${result.ok ? "text-status-emerald" : "text-status-red"}`}>
          {result.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
          {result.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void pick()} disabled={busy !== null} className={meta ? "btn-ghost h-8" : "btn-primary h-8"}>
          {busy === "pick" && <Loader2 size={14} className="animate-spin" />} {meta ? "Выбрать другую" : "Выбрать файл модели (.gguf)"}
        </button>
        {meta && (
          <button onClick={() => void test()} disabled={busy !== null} className="btn-ghost h-8">
            {busy === "test" && <Loader2 size={14} className="animate-spin" />} Проверить
          </button>
        )}
        <button onClick={() => setHelp((v) => !v)} className="text-[12px] text-on-surface-variant hover:text-on-surface hover:underline">
          Какую модель взять?
        </button>
        {meta ? (
          <button onClick={() => void off()} className="ml-auto text-[12px] font-semibold text-status-red hover:underline">Отключить</button>
        ) : (
          <button onClick={() => setOpen(false)} className="ml-auto text-[12px] text-on-surface-variant hover:underline">Скрыть</button>
        )}
      </div>

      {onCpu && result?.ok && (
        <p className="rounded-md bg-status-amber/10 px-3 py-2 text-[12px] leading-snug text-on-surface">
          Считает процессор. Быстрые кнопки чата (слабые места, сроки, вопросы директору, проверка формулировок) отвечают мгновенно — справку разбирает программа. «Переписать пункт» — около минуты. Свой вопрос модель читает медленно (несколько минут) и видит только выжимку справки. Полный разбор моделью — на ноутбуке с видеокартой.
        </p>
      )}
      {!canRememberFile() && <p className="text-[11px] leading-snug text-status-amber">Этот браузер не запоминает файл — после перезагрузки страницы его нужно выбрать снова. В Edge и Chrome запоминается.</p>}

      {help && (
        <div className="space-y-1.5 border-t border-outline-variant pt-2 text-[12px] leading-snug text-on-surface-variant">
          <p>Скачайте файл <b>.gguf</b> на сайте Hugging Face (вкладка «Files», файл с нужным окончанием) и положите на флешку или общий диск:</p>
          <ul className="space-y-1">
            {MODELS.map((m) => (
              <li key={m.pc + m.file}>
                <span className="text-on-surface">{m.pc}:</span>{" "}
                <a href={m.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{m.name}</a> — файл с «{m.file}» ({m.size})
              </li>
            ))}
          </ul>
          <p>Модели больше ~3 ГБ (8B и крупнее) в браузер не помещаются. Первый вопрос после открытия страницы ждёт загрузки модели в память (10–40 с), дальше быстрее.</p>
          <p>Встроенная графика ноутбука (Intel Iris/UHD) считает медленнее процессора — поэтому «Авто» берёт видеокарту, только если она отдельная. Если на игровом ноутбуке «Проверить» показывает «на процессоре» или медленно: Параметры Windows → Система → Дисплей → Графика → Microsoft Edge (или Chrome) → «Высокая производительность», перезапустить браузер.</p>
        </div>
      )}
    </div>
  );
}
