"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { composeText, type MemoField } from "@/lib/memo";

type Sample = { title: string; comment: string | null; segmentName: string | null; trackName: string | null; ownerName: string | null; deadline: string | null; statusName: string | null; cost: string | null; attractivenessName: string | null; custom: Record<string, string> };

/**
 * Вид справки дирекции: отмеченные столбцы — это и есть содержимое справки. «Трек» и «Сегмент» задают структуру
 * (разделы по трекам; только сегмент — по сегментам; ни того, ни другого — просто список пунктов), остальные
 * складываются в текст пункта. Список столбцов берётся из настоящей таблицы (Настройки → Колонки таблицы).
 *
 * Два режима: рядом с живой справкой (`onApplied`, экран «Оперативка») настройка применяется сразу по клику —
 * родитель перезагружает документ, и лист показывает настоящий результат, а не копию расчёта. На странице
 * Настроек живого документа нет, поэтому там кнопка «Сохранить» и пример на реальной строке.
 */
export function MemoViewSettings({ compact = false, onApplied }: { compact?: boolean; onApplied?: () => void }) {
  const [shortName, setShortName] = useState("");
  const [fields, setFields] = useState<MemoField[]>(["track", "comment"]);
  const [options, setOptions] = useState<Array<{ key: MemoField; label: string }>>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [sample, setSample] = useState<Sample | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/memo-sections")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setShortName(d.shortName ?? "");
        setFields(d.config.fields);
        setOptions(d.fields);
        setLabels(d.labels);
        setSample(d.sample);
        setLoaded(true);
      });
  }, []);

  const put = useCallback(async (nextFields: MemoField[], nextShort: string) => {
    return fetch("/api/memo-sections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shortName: nextShort.trim() || null, config: { fields: nextFields } }),
    });
  }, []);

  // применение по клику (рядом с живым документом): один запрос на серию быстрых кликов, потом родитель перечитывает справку
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ fields: MemoField[]; shortName: string } | null>(null);
  const applyNow = useCallback(async () => {
    const payload = pending.current;
    if (!payload) return;
    pending.current = null;
    setSaving(true);
    const r = await put(payload.fields, payload.shortName).catch(() => null);
    setSaving(false);
    setMessage(r?.ok ? null : "Не удалось применить настройку.");
    if (r?.ok) onApplied?.();
  }, [put, onApplied]);

  const scheduleApply = (nextFields: MemoField[], nextShort: string) => {
    if (!onApplied) return;
    pending.current = { fields: nextFields, shortName: nextShort };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void applyNow(), 350);
  };

  // поповер закрыли сразу после клика — досохраняем, чтобы правка не потерялась
  const applyRef = useRef(applyNow);
  useEffect(() => {
    applyRef.current = applyNow;
  }, [applyNow]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void applyRef.current();
    },
    []
  );

  // порядок в тексте пункта — как порядок столбцов в таблице
  const toggle = (k: MemoField) => {
    const raw = fields.includes(k) ? fields.filter((x) => x !== k) : [...fields, k];
    if (raw.length === 0) {
      setMessage("Оставьте хотя бы один столбец.");
      return;
    }
    const next = options.map((o) => o.key).filter((key) => raw.includes(key));
    setMessage(null);
    setFields(next);
    scheduleApply(next, shortName);
  };

  const changeShortName = (v: string) => {
    setShortName(v);
    scheduleApply(fields, v);
  };

  async function save() {
    setSaving(true);
    setMessage(null);
    const r = await put(fields, shortName);
    setSaving(false);
    if (r.ok) {
      setMessage("Сохранено. Пункты, которые вы не редактировали вручную, обновятся сами; изменённые останутся как есть.");
      onApplied?.();
    } else {
      setMessage("Не удалось сохранить.");
    }
  }

  if (!loaded) return <div className="skeleton h-40 rounded-lg" />;
  const preview = sample ? composeText(sample, fields, labels) : "Пример появится, когда в таблице будут строки.";
  const heading = compact ? "label-caps" : "label-caps mb-2";
  const hint = "«Трек» и «Сегмент» задают разделы справки: отмечен трек — разделы по трекам, только сегмент — по сегментам, ничего — просто список пунктов. Остальные столбцы идут в текст пункта.";

  return (
    <div className={compact ? "space-y-4" : ""}>
      <div>
        <h3 className={heading}>Что входит в справку</h3>
        {!compact && <p className="mb-2 text-[12px] text-on-surface-variant">{hint}</p>}
        <div className={`flex flex-wrap gap-2 ${compact ? "mt-1.5" : "mb-3 max-w-2xl"}`}>
          {options.map((f) => (
            <label key={f.key} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] ${fields.includes(f.key) ? "border-primary bg-primary-soft text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-low"}`}>
              <input type="checkbox" checked={fields.includes(f.key)} onChange={() => toggle(f.key)} className="accent-primary" />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      {onApplied ? (
        <p className="rounded-md border border-outline-variant bg-surface-low px-3 py-2 text-[12px] leading-snug text-on-surface-variant">
          {hint} Справка на странице меняется сразу; пункты, которые вы правили вручную, остаются как есть.
        </p>
      ) : (
        <div className={`rounded-md border border-outline-variant bg-surface-low px-3 py-2.5 ${compact ? "" : "mb-6 max-w-2xl"}`}>
          <p className="label-caps mb-1">Так будет выглядеть пункт</p>
          <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.55] text-on-surface">• {preview}</p>
          <p className="mt-1 text-[11px] text-on-surface-variant">Если комментария нет, вместо него берётся название задачи. Уже готовый текст всегда можно поправить в редакторе.</p>
        </div>
      )}

      <div className={compact ? "" : "max-w-md"}>
        <label className="mb-1 block text-[12px] font-medium text-on-surface-variant">Короткое название дирекции для заголовка</label>
        <input value={shortName} onChange={(e) => changeShortName(e.target.value)} placeholder="Например: РФ и КЭ" className="input w-full" maxLength={60} />
      </div>

      <div className="flex items-center gap-2">
        {!onApplied && (
          <button onClick={() => void save()} disabled={saving} className="btn-primary h-9">
            Сохранить
          </button>
        )}
        {onApplied && saving && <span className="text-[12px] text-on-surface-variant">Применяю…</span>}
        {message && (
          <span className="flex items-center gap-1 text-[12px] text-on-surface-variant">
            {message.startsWith("Сохранено") && <Check size={13} className="text-status-emerald" />}
            {message}
          </span>
        )}
      </div>
    </div>
  );
}
