"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { canShareTemplates } from "@/lib/report-templates";
import { ExportMenu } from "@/components/ExportMenu";
import { FilterChip, type Option } from "@/components/FilterChips";
import { ReportTree, SummaryTiles } from "@/components/ReportView";
import { Panel } from "@/components/ui/Panel";
import { MenuItem, Popover } from "@/components/ui/Popover";
import { loadBootstrap, type Bootstrap } from "@/lib/client-bootstrap";
import {
  COLUMN_LABEL,
  DEFAULT_TEMPLATE_ID,
  GROUP_KEYS,
  GROUP_LABEL,
  STD_COLUMNS,
  SYSTEM_TEMPLATES,
  resolveConfig,
  type GroupKey,
  type ReportConfig,
} from "@/lib/report-config";
import type { ReportModel } from "@/lib/report";

type Template = { id: string; name: string; scope: "SYSTEM" | "PERSONAL" | "SHARED"; config: ReportConfig; canEdit: boolean };
type ApiTemplate = { id: string; name: string; scope: "PERSONAL" | "SHARED"; config: ReportConfig; canEdit: boolean };

const STORAGE_KEY = "operativka.reportTemplate";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const SORT_LABEL: Record<string, string> = { deadline: "Дедлайн", name: "Задача", status: "Статус", owner: "Ответственный", updatedAt: "Дата обновления" };

/**
 * Отчёт «Оперативки»: выбор шаблона, конструктор (колонки, группировка, фильтры), сохранение шаблона, экспорт.
 * Экран и файлы строятся из одной конфигурации, поэтому совпадают.
 */
export function ReportSection({ onModel, refreshKey, cycleId }: { onModel?: (m: ReportModel | null) => void; refreshKey?: string; /** Если задан — отчёт строится по финальному снимку этого цикла, а не по живым данным. */ cycleId?: string }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [saved, setSaved] = useState<ApiTemplate[]>([]);
  const [activeId, setActiveId] = useState<string>(DEFAULT_TEMPLATE_ID);
  const [config, setConfig] = useState<ReportConfig>(SYSTEM_TEMPLATES[0].config);
  const [model, setModel] = useState<ReportModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [builder, setBuilder] = useState(false);

  const templates = useMemo<Template[]>(
    () => [
      ...SYSTEM_TEMPLATES.map((t) => ({ id: t.id, name: t.name, scope: "SYSTEM" as const, config: t.config, canEdit: false })),
      ...saved.map((t) => ({ ...t })),
    ],
    [saved]
  );
  const active = templates.find((t) => t.id === activeId) ?? templates[0];
  const dirty = !same(config, active.config);
  const role = boot?.user?.role;
  const canShare = !!role && canShareTemplates(role);
  const canSave = role !== "EXECUTIVE"; // руководство шаблонов не хранит: у него только финалы

  const reloadTemplates = useCallback(async () => {
    const d = await fetch("/api/report-templates").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setSaved(d?.templates ?? []);
    return (d?.templates ?? []) as ApiTemplate[];
  }, []);

  // при открытии: справочники для конструктора, сохранённые шаблоны, последний выбранный шаблон
  useEffect(() => {
    (async () => {
      const [b, list] = await Promise.all([loadBootstrap(), reloadTemplates()]);
      setBoot(b);
      let id = DEFAULT_TEMPLATE_ID;
      try {
        id = localStorage.getItem(STORAGE_KEY) || DEFAULT_TEMPLATE_ID;
      } catch {
        // не критично
      }
      const all = [...SYSTEM_TEMPLATES.map((t) => ({ id: t.id, config: t.config })), ...list.map((t) => ({ id: t.id, config: t.config }))];
      const found = all.find((t) => t.id === id) ?? all[0];
      setActiveId(found.id);
      setConfig(found.config);
    })();
  }, [reloadTemplates]);

  // построение отчёта при любом изменении настроек (с небольшой задержкой, чтобы не слать запрос на каждый клик)
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      fetch(cycleId ? `/api/cycles/${cycleId}/report` : "/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config }) })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          setModel(d.model);
          onModel?.(d.model);
          setError(null);
        })
        .catch(() => setError("Не удалось построить отчёт. Проверьте соединение и повторите."))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
    // onModel из родителя стабилен (setState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, refreshKey, cycleId]);

  function pick(t: Template) {
    setActiveId(t.id);
    setConfig(t.config);
    try {
      localStorage.setItem(STORAGE_KEY, t.id);
    } catch {
      // не критично
    }
  }

  const exportParams = useMemo(() => new URLSearchParams({ config: JSON.stringify(config) }), [config]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Popover
          width={300}
          trigger={({ toggle }) => (
            <button onClick={toggle} className="flex h-9 items-center gap-2 rounded-md border border-outline-variant bg-surface px-3 transition-colors hover:bg-surface-high">
              <span className="label-caps">Шаблон</span>
              <span className="max-w-56 truncate text-[13px] font-semibold text-on-surface">
                {active.name}
                {dirty && <span className="ml-1 font-normal text-status-amber" title="Есть несохранённые изменения">●</span>}
              </span>
              <ChevronDown size={14} className="text-outline" />
            </button>
          )}
        >
          {(close) => (
            <div className="max-h-80 overflow-y-auto py-1">
              {(["SYSTEM", "SHARED", "PERSONAL"] as const).map((scope) => {
                const list = templates.filter((t) => t.scope === scope);
                if (list.length === 0) return null;
                return (
                  <div key={scope}>
                    <p className="label-caps px-3.5 pb-0.5 pt-2">{scope === "SYSTEM" ? "Стандартные" : scope === "SHARED" ? "Общие" : "Мои"}</p>
                    {list.map((t) => (
                      <MenuItem
                        key={t.id}
                        onClick={() => {
                          pick(t);
                          close();
                        }}
                        icon={t.id === active.id ? <Check size={15} className="text-primary" /> : <span className="w-[15px]" />}
                      >
                        {t.name}
                      </MenuItem>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </Popover>

        <button onClick={() => setBuilder(true)} className={`btn-ghost ${builder ? "border-primary bg-primary-soft text-primary" : ""}`}>
          <SlidersHorizontal size={15} />
          Настроить
        </button>
        {dirty && (
          <button onClick={() => setConfig(active.config)} className="flex h-9 items-center px-2 text-[12px] font-semibold text-primary hover:underline">
            Сбросить изменения
          </button>
        )}
        <div className="ml-auto">
          <ExportMenu endpoint={cycleId ? `/api/cycles/${cycleId}/export` : "/api/export/report"} params={exportParams} withPptx />
        </div>
      </div>

      {error && <p className="rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-[13px] text-status-red">{error}</p>}

      <div className={loading && model ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {model ? (
          <div className="space-y-5">
            {model.showSummary && <SummaryTiles model={model} />}
            <ReportTree model={model} />
          </div>
        ) : (
          !error && <div className="skeleton h-40 rounded-lg" />
        )}
      </div>

      {builder && boot && (
        <Panel title="Настройка отчёта" subtitle={`Шаблон: ${active.name}`} width={480} onClose={() => setBuilder(false)}>
          <Builder
            boot={boot}
            config={config}
            onChange={setConfig}
            active={active}
            canShare={canShare}
            canSave={canSave}
            onSaved={async (id) => {
              await reloadTemplates();
              setActiveId(id);
              try {
                localStorage.setItem(STORAGE_KEY, id);
              } catch {
                // не критично
              }
            }}
            onDeleted={async () => {
              await reloadTemplates();
              pick(templates[0]);
            }}
          />
        </Panel>
      )}
    </div>
  );
}

function Builder({
  boot,
  config,
  onChange,
  active,
  canShare,
  canSave,
  onSaved,
  onDeleted,
}: {
  boot: Bootstrap;
  config: ReportConfig;
  onChange: (c: ReportConfig) => void;
  active: Template;
  canShare: boolean;
  canSave: boolean;
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const cfg = resolveConfig(config);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"PERSONAL" | "SHARED">("PERSONAL");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<ReportConfig>) => onChange({ ...config, ...patch });

  // все возможные колонки: стандартные и свои; выбранные идут первыми в своём порядке
  const allColumns = useMemo(
    () => [...STD_COLUMNS.map((k) => ({ key: k as string, label: COLUMN_LABEL[k] })), ...boot.columns.map((c) => ({ key: `custom:${c.id}`, label: c.name }))],
    [boot.columns]
  );
  const label = (k: string) => allColumns.find((c) => c.key === k)?.label ?? k;
  const chosen = cfg.columns.filter((k) => allColumns.some((c) => c.key === k));
  const rest = allColumns.filter((c) => !chosen.includes(c.key));

  const toggleColumn = (key: string, on: boolean) => {
    if (on) set({ columns: [...chosen, key] });
    else if (chosen.length > 1) set({ columns: chosen.filter((k) => k !== key) });
  };
  const move = (key: string, dir: -1 | 1) => {
    const i = chosen.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= chosen.length) return;
    const next = [...chosen];
    [next[i], next[j]] = [next[j], next[i]];
    set({ columns: next });
  };

  const setLevel = (level: number, value: string) => {
    const next = [...cfg.groupBy];
    if (value === "") next.splice(level);
    else {
      next[level] = value as GroupKey;
      // одно поле не может быть на двух уровнях
      for (let i = 0; i < next.length; i++) if (i !== level && next[i] === value) next.splice(i, 1);
    }
    set({ groupBy: next.filter(Boolean) as GroupKey[] });
  };

  const setFilter = (k: keyof NonNullable<ReportConfig["filters"]>, v: string[] | boolean) => set({ filters: { ...cfg.filters, [k]: v } });

  const opt = (list: Array<{ id: string; name: string }>): Option[] => list.map((x) => ({ id: x.id, name: x.name }));

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { ok: res.ok, data: await res.json().catch(() => null) };
  }

  async function saveAs() {
    setMsg(null);
    const r = await call("/api/report-templates", "POST", { name: name.trim(), scope, config });
    if (!r.ok) return setMsg({ tone: "error", text: "Не удалось сохранить шаблон." });
    setName("");
    setMsg({ tone: "ok", text: "Шаблон сохранён." });
    await onSaved(r.data.template.id);
  }
  async function saveChanges() {
    setMsg(null);
    const r = await call(`/api/report-templates/${active.id}`, "PATCH", { config });
    if (!r.ok) return setMsg({ tone: "error", text: "Не удалось сохранить изменения." });
    setMsg({ tone: "ok", text: "Изменения сохранены." });
    await onSaved(active.id);
  }
  async function remove() {
    const r = await call(`/api/report-templates/${active.id}`, "DELETE");
    setConfirmDelete(false);
    if (!r.ok) return setMsg({ tone: "error", text: "Не удалось удалить шаблон." });
    await onDeleted();
  }

  const dirty = !same(config, active.config);
  const editingSaved = active.scope !== "SYSTEM" && active.canEdit;

  return (
    <div className="space-y-6 px-5 py-4">
      <Block title="Название отчёта">
        <input value={cfg.title ?? ""} onChange={(e) => set({ title: e.target.value })} placeholder="Например: Недельная оперативка" maxLength={120} className="input w-full" />
      </Block>

      <Block title="Колонки" hint="Галочка — показывать; стрелки меняют порядок.">
        <ul className="divide-y divide-outline-variant/60 rounded-md border border-outline-variant">
          {chosen.map((k, i) => (
            <li key={k} className="flex items-center gap-2 px-3 py-1.5">
              <input type="checkbox" checked onChange={() => toggleColumn(k, false)} className="h-4 w-4 accent-primary" disabled={chosen.length <= 1} />
              <span className="flex-1 truncate text-[13px] text-on-surface">{label(k)}</span>
              <button onClick={() => move(k, -1)} disabled={i === 0} className="btn-icon h-7 w-7 disabled:opacity-30" aria-label="Выше"><ArrowUp size={14} /></button>
              <button onClick={() => move(k, 1)} disabled={i === chosen.length - 1} className="btn-icon h-7 w-7 disabled:opacity-30" aria-label="Ниже"><ArrowDown size={14} /></button>
            </li>
          ))}
          {rest.map((c) => (
            <li key={c.key} className="flex items-center gap-2 px-3 py-1.5">
              <input type="checkbox" checked={false} onChange={() => toggleColumn(c.key, true)} className="h-4 w-4 accent-primary" />
              <span className="flex-1 truncate text-[13px] text-on-surface-variant">{c.label}</span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Группировка" hint="Как сгруппировать задачи: например, Сегмент → Трек. Колонки, ставшие группами, из таблицы убираются.">
        <div className="space-y-2">
          {[0, 1, 2].map((level) => {
            if (level > cfg.groupBy.length) return null;
            return (
              <div key={level} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[12px] text-on-surface-variant">Уровень {level + 1}</span>
                <select value={cfg.groupBy[level] ?? ""} onChange={(e) => setLevel(level, e.target.value)} className="select flex-1">
                  <option value="">{level === 0 ? "Без группировки" : "— нет —"}</option>
                  {GROUP_KEYS.map((g) => (
                    <option key={g} value={g}>{GROUP_LABEL[g]}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </Block>

      <Block title="Сводка">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-[13px] text-on-surface">
            <input type="checkbox" checked={cfg.options.summary} onChange={(e) => set({ options: { ...cfg.options, summary: e.target.checked } })} className="h-4 w-4 accent-primary" />
            Показывать сводку «Статус текущих задач»
          </label>
        </div>
      </Block>

      <Block title="Сортировка внутри группы">
        <div className="flex gap-2">
          <select value={cfg.sort.by} onChange={(e) => set({ sort: { ...cfg.sort, by: e.target.value as typeof cfg.sort.by } })} className="select flex-1">
            {Object.entries(SORT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select value={cfg.sort.dir} onChange={(e) => set({ sort: { ...cfg.sort, dir: e.target.value as "asc" | "desc" } })} className="select">
            <option value="asc">По возрастанию</option>
            <option value="desc">По убыванию</option>
          </select>
        </div>
      </Block>

      <Block title="Фильтры" hint="Что включить в отчёт. Пусто — все.">
        <div className="flex flex-wrap gap-2">
          <FilterChip label="Сегмент" value={cfg.filters.segmentIds ?? []} options={opt(boot.segments)} onChange={(v) => setFilter("segmentIds", v)} />
          <FilterChip label="Трек" value={cfg.filters.trackIds ?? []} options={opt(boot.tracks)} onChange={(v) => setFilter("trackIds", v)} />
          <FilterChip label="Статус" value={cfg.filters.statusIds ?? []} options={opt(boot.statuses)} onChange={(v) => setFilter("statusIds", v)} />
          <FilterChip label="Ответственный" value={cfg.filters.ownerIds ?? []} options={opt(boot.users)} onChange={(v) => setFilter("ownerIds", v)} />
        </div>
        <div className="mt-3 space-y-1.5">
          <label className="flex items-center gap-2 text-[13px] text-on-surface">
            <input type="checkbox" checked={!!cfg.filters.sentOnly} onChange={(e) => setFilter("sentOnly", e.target.checked)} className="h-4 w-4 accent-primary" />
            Только отправленные директору («Опер»)
          </label>
          <label className="flex items-center gap-2 text-[13px] text-on-surface">
            <input type="checkbox" checked={!!cfg.filters.overdueOnly} onChange={(e) => setFilter("overdueOnly", e.target.checked)} className="h-4 w-4 accent-primary" />
            Только просроченные
          </label>
        </div>
      </Block>

      {canSave && (
      <Block title="Сохранить как шаблон" hint="Шаблон можно выбрать в любой момент и использовать для выгрузки.">
        {msg && (
          <p className={`mb-2 rounded-md border px-3 py-2 text-[12px] ${msg.tone === "ok" ? "border-status-emerald/30 bg-status-emerald/10 text-emerald-800" : "border-status-red/30 bg-status-red/10 text-status-red"}`}>{msg.text}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название шаблона" maxLength={80} className="input min-w-40 flex-1" />
          <select value={scope} onChange={(e) => setScope(e.target.value as "PERSONAL" | "SHARED")} className="select">
            <option value="PERSONAL">Личный</option>
            {canShare && <option value="SHARED">Для всех</option>}
          </select>
          <button onClick={saveAs} disabled={!name.trim()} className="btn-primary">
            <Save size={15} />
            Сохранить
          </button>
        </div>

        {editingSaved && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-outline-variant pt-3">
            <span className="text-[12px] text-on-surface-variant">Шаблон «{active.name}»:</span>
            <button onClick={saveChanges} disabled={!dirty} className="btn-ghost h-8">Сохранить изменения</button>
            {confirmDelete ? (
              <>
                <button onClick={remove} className="btn-primary h-8 bg-status-red hover:bg-status-red">Да, удалить</button>
                <button onClick={() => setConfirmDelete(false)} className="btn-ghost h-8">Нет</button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="btn-icon h-8 w-8 text-status-red" title="Удалить шаблон" aria-label="Удалить шаблон">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
      </Block>
      )}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="label-caps mb-1">{title}</h3>
      {hint && <p className="mb-2 text-[12px] text-on-surface-variant">{hint}</p>}
      {children}
    </section>
  );
}
