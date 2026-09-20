"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Lock, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { clearBootstrap } from "@/lib/client-bootstrap";
import { COLUMN_TYPE_LABEL, parseOptions, type ColumnType } from "@/lib/custom-columns";
import { DEFAULT_COLUMNS, loadLocalColumns, normalizeColumns, withCustomColumns, type ColumnConfig, type ColumnKey, type CustomCol } from "@/lib/table-columns";

/**
 * Настройки → «Колонки таблицы».
 * Вид таблицы общий: всё, что меняет куратор (показ, порядок, подписи, удаление стандартных колонок,
 * создание и удаление своих), сразу действует у всех пользователей.
 */
export function ColumnsSettings() {
  const canManage = true; // страница доступна только куратору и администратору
  const [saved, setSaved] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [customCols, setCustomCols] = useState<CustomCol[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<ColumnType>("TEXT");
  const [newOptions, setNewOptions] = useState("");

  const columns = useMemo(() => withCustomColumns(saved, customCols), [saved, customCols]);
  const active = columns.filter((c) => !c.removed);
  const removed = columns.filter((c) => c.removed);
  const visibleTotal = active.filter((c) => c.visible).reduce((s, c) => s + c.width, 0) || 1;
  const opts = parseOptions(newOptions);
  const canAdd = newName.trim() && (newType !== "SELECT" || opts.length > 0);

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback((next: ColumnConfig[]) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      fetch("/api/table-columns", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ columns: next }) })
        .then(() => clearBootstrap())
        .catch(() => setError("Не удалось сохранить настройки."));
    }, 400);
  }, []);
  const change = (next: ColumnConfig[]) => {
    setSaved(next);
    persist(next);
  };

  const reloadCustom = useCallback(async () => {
    const d = await fetch("/api/columns").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setCustomCols(d?.columns ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      const [mine] = await Promise.all([fetch("/api/table-columns").then((r) => (r.ok ? r.json() : null)).catch(() => null), reloadCustom()]);
      if (mine?.columns) setSaved(normalizeColumns(mine.columns));
      else {
        const local = loadLocalColumns();
        if (local) setSaved(normalizeColumns(local));
      }
      setLoading(false);
    })();
  }, [reloadCustom]);

  const update = (key: ColumnKey, patch: Partial<ColumnConfig>) => change(columns.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  function move(key: ColumnKey, dir: -1 | 1) {
    const idx = active.findIndex((c) => c.key === key);
    const other = active[idx + dir];
    if (idx < 0 || !other) return;
    const next = [...columns];
    const a = next.findIndex((c) => c.key === key);
    const b = next.findIndex((c) => c.key === other.key);
    [next[a], next[b]] = [next[b], next[a]];
    change(next);
  }

  async function api(url: string, method: string, body?: unknown, fail = "Не удалось выполнить действие.") {
    setError(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) setError(fail);
    else {
      clearBootstrap();
      await reloadCustom();
    }
    return res.ok;
  }

  async function addCustom() {
    const ok = await api("/api/columns", "POST", { name: newName.trim(), type: newType, options: newType === "SELECT" ? opts : undefined }, "Не удалось добавить колонку.");
    if (ok) {
      setNewName("");
      setNewOptions("");
      setNewType("TEXT");
      setAdding(false);
    }
  }

  if (loading) return <div className="skeleton h-40 max-w-2xl rounded" />;

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <h2 className="text-2xl font-semibold leading-8 text-on-surface">Колонки таблицы</h2>
        <p className="text-[13px] text-on-surface-variant">
          Галочка — колонка показана в таблице. Корзина убирает колонку; убранные можно вернуть внизу списка. Всё, что вы меняете здесь, применяется у всех пользователей.
        </p>
      </div>

      {error && <p className="mb-3 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-[13px] text-status-red">{error}</p>}

      <div className="mb-2 flex justify-end">
        <button onClick={() => change(DEFAULT_COLUMNS)} className="btn-ghost h-8">
          <RotateCcw size={14} />
          Сбросить к стандартным
        </button>
      </div>

      <ul className="divide-y divide-outline-variant/60 overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-sm">
        {active.map((col, i) => {
          const custom = col.key.startsWith("custom:");
          const customId = custom ? col.key.slice("custom:".length) : "";
          const def = custom ? customCols.find((c) => c.id === customId) : undefined;
          return (
            <li key={col.key} className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={col.visible} onChange={(e) => update(col.key, { visible: e.target.checked })} className="h-4 w-4 accent-primary" title={col.visible ? "Скрыть колонку" : "Показать колонку"} />

                <div className="min-w-0 flex-1">
                  {renameKey === col.key ? (
                    <div className="flex items-center gap-2">
                      <input value={renameText} onChange={(e) => setRenameText(e.target.value)} autoFocus className="input h-8 min-w-0 flex-1" />
                      <button
                        disabled={!renameText.trim()}
                        onClick={async () => {
                          if (custom) await api(`/api/columns/${customId}`, "PATCH", { name: renameText.trim() }, "Не удалось переименовать колонку.");
                          else update(col.key, { label: renameText.trim() });
                          setRenameKey(null);
                        }}
                        className="btn-primary h-8"
                      >
                        Сохранить
                      </button>
                      <button onClick={() => setRenameKey(null)} className="btn-ghost h-8">Отмена</button>
                    </div>
                  ) : (
                    <>
                      <p className="truncate text-[13px] font-semibold text-on-surface">{col.label}</p>
                      <p className="text-[11px] text-outline">
                        {custom ? `Своя колонка · ${def ? COLUMN_TYPE_LABEL[def.type] : ""}${def?.type === "SELECT" ? `: ${def.options.join(", ")}` : ""}` : "Стандартная колонка"}
                        {col.visible ? ` · ${Math.round((col.width / visibleTotal) * 100)}% ширины` : " · скрыта"}
                      </p>
                    </>
                  )}
                </div>

                {renameKey !== col.key && (
                  <div className="flex shrink-0 items-center">
                    <button onClick={() => move(col.key, -1)} disabled={i === 0} className="btn-icon h-8 w-8 disabled:opacity-30" title="Выше" aria-label="Выше"><ArrowUp size={14} /></button>
                    <button onClick={() => move(col.key, 1)} disabled={i === active.length - 1} className="btn-icon h-8 w-8 disabled:opacity-30" title="Ниже" aria-label="Ниже"><ArrowDown size={14} /></button>
                    {(!custom || canManage) && (
                      <button onClick={() => { setRenameKey(col.key); setRenameText(col.label); }} className="btn-icon h-8 w-8" title="Переименовать" aria-label="Переименовать"><Pencil size={14} /></button>
                    )}
                    {col.key === "name" ? (
                      <span className="flex h-8 w-8 items-center justify-center text-outline" title="Обязательная колонка: без неё таблица теряет смысл"><Lock size={14} /></span>
                    ) : custom ? (
                      canManage && (
                        <button onClick={() => setConfirmKey(col.key)} className="btn-icon h-8 w-8 text-status-red" title="Удалить колонку" aria-label="Удалить колонку"><Trash2 size={15} /></button>
                      )
                    ) : (
                      <button onClick={() => update(col.key, { removed: true, visible: false })} className="btn-icon h-8 w-8 text-status-red" title="Убрать колонку из таблицы" aria-label="Убрать колонку"><Trash2 size={15} /></button>
                    )}
                  </div>
                )}
              </div>

              {custom && confirmKey === col.key && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md border border-status-red/30 bg-status-red/5 px-3 py-2">
                  <span className="flex-1 text-[13px] text-on-surface">Удалить колонку «{col.label}»? Она пропадёт у всех, введённые значения сохранятся в истории.</span>
                  <button
                    onClick={async () => { await api(`/api/columns/${customId}`, "DELETE", undefined, "Не удалось удалить колонку."); setConfirmKey(null); }}
                    className="btn-primary h-8 bg-status-red hover:bg-status-red"
                  >
                    Да, удалить
                  </button>
                  <button onClick={() => setConfirmKey(null)} className="btn-ghost h-8">Отмена</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {removed.length > 0 && (
        <div className="mt-5">
          <p className="label-caps mb-1.5">Убранные колонки</p>
          <ul className="divide-y divide-outline-variant/60 overflow-hidden rounded-lg border border-outline-variant bg-surface">
            {removed.map((col) => (
              <li key={col.key} className="flex items-center gap-3 px-4 py-2">
                <span className="flex-1 truncate text-[13px] text-on-surface-variant">{col.label}</span>
                <button onClick={() => update(col.key, { removed: false, visible: true })} className="btn-ghost h-8">
                  <RotateCcw size={14} />
                  Вернуть
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage && (
        <div className="mt-5 rounded-lg border border-outline-variant bg-surface p-4">
          {!adding ? (
            <button onClick={() => setAdding(true)} className="btn-primary">
              <Plus size={16} />
              Добавить свою колонку
            </button>
          ) : (
            <div className="space-y-3">
              <p className="label-caps">Новая колонка</p>
              <div className="flex flex-wrap gap-2">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Название колонки" autoFocus className="input min-w-48 flex-1" />
                <select value={newType} onChange={(e) => setNewType(e.target.value as ColumnType)} className="select">
                  {(Object.keys(COLUMN_TYPE_LABEL) as ColumnType[]).map((t) => (
                    <option key={t} value={t}>{COLUMN_TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </div>
              {newType === "SELECT" && <input value={newOptions} onChange={(e) => setNewOptions(e.target.value)} placeholder="Варианты через запятую: Высокий, Средний, Низкий" className="input w-full" />}
              <div className="flex gap-2">
                <button disabled={!canAdd} onClick={addCustom} className="btn-primary">Добавить</button>
                <button onClick={() => setAdding(false)} className="btn-ghost">Отмена</button>
              </div>
            </div>
          )}
          <p className="mt-3 text-[12px] text-on-surface-variant">Новая колонка появляется в таблице у всех, а значения вносят те, кто правит позицию.</p>
        </div>
      )}
    </div>
  );
}
