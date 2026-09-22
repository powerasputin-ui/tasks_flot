"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { composeText, type MemoField } from "@/lib/memo";

type Sample = { title: string; comment: string | null; segmentName: string | null; trackName: string | null; ownerName: string | null; deadline: string | null; statusName: string | null; cost: string | null; attractivenessName: string | null; custom: Record<string, string> };

/**
 * Вид справки дирекции: какие столбцы таблицы попадают в текст пункта — единственная настройка. Список столбцов
 * берётся из настоящей таблицы (Настройки → Колонки таблицы): что там есть, то и здесь можно отметить, в любом
 * сочетании. На разделы («1. …», «2. …») справка делится по трекам — это фиксировано и не настраивается.
 * Используется и в Настройках (полный вид), и как быстрая панель прямо на экране «Оперативка» (compact).
 */
export function MemoViewSettings({ compact = false, onSaved }: { compact?: boolean; onSaved?: () => void }) {
  const [shortName, setShortName] = useState("");
  const [fields, setFields] = useState<MemoField[]>(["comment"]);
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

  // порядок в тексте пункта — как порядок столбцов в таблице
  const toggle = (k: MemoField) =>
    setFields((f) => {
      const next = f.includes(k) ? f.filter((x) => x !== k) : [...f, k];
      if (next.length === 0) return f;
      return options.map((o) => o.key).filter((key) => next.includes(key));
    });

  async function save() {
    setSaving(true);
    setMessage(null);
    const r = await fetch("/api/memo-sections", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shortName: shortName.trim() || null, config: { fields } }) });
    setSaving(false);
    if (r.ok) {
      setMessage("Сохранено. Новые пункты будут собираться уже так.");
      onSaved?.();
    } else {
      setMessage("Не удалось сохранить.");
    }
  }

  if (!loaded) return <div className="skeleton h-40 rounded-lg" />;
  const preview = sample ? composeText(sample, fields, labels) : "Пример появится, когда в таблице будут строки.";
  const heading = compact ? "label-caps" : "label-caps mb-2";

  return (
    <div className={compact ? "space-y-4" : ""}>
      <div>
        <h3 className={heading}>Столбцы таблицы в тексте пункта</h3>
        {!compact && <p className="mb-2 text-[12px] text-on-surface-variant">Отметьте, что войдёт в справку. На разделы («1. …», «2. …») справка делится по трекам.</p>}
        <div className={`flex flex-wrap gap-2 ${compact ? "mt-1.5" : "mb-3 max-w-2xl"}`}>
          {options.map((f) => (
            <label key={f.key} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] ${fields.includes(f.key) ? "border-primary bg-primary-soft text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-low"}`}>
              <input type="checkbox" checked={fields.includes(f.key)} onChange={() => toggle(f.key)} className="accent-primary" />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      <div className={`rounded-md border border-outline-variant bg-surface-low px-3 py-2.5 ${compact ? "" : "mb-6 max-w-2xl"}`}>
        <p className="label-caps mb-1">Так будет выглядеть пункт</p>
        <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.55] text-on-surface">• {preview}</p>
        <p className="mt-1 text-[11px] text-on-surface-variant">Если комментария нет, вместо него берётся название задачи. Уже готовый текст всегда можно поправить в редакторе.</p>
      </div>

      <div className={compact ? "" : "max-w-md"}>
        <label className="mb-1 block text-[12px] font-medium text-on-surface-variant">Короткое название дирекции для заголовка</label>
        <input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Например: РФ и КЭ" className="input w-full" maxLength={60} />
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => void save()} disabled={saving} className="btn-primary h-9">
          Сохранить
        </button>
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
