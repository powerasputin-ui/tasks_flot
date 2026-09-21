"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, Columns3, FileText, KeyRound, Layers, ListChecks, Pencil, Plus, Route, Search, Star, Trash2, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Panel } from "@/components/ui/Panel";
import { ROLE_LABEL } from "@/components/AppShell";
import { ColumnsSettings } from "@/components/ColumnsSettings";
import { clearBootstrap } from "@/lib/client-bootstrap";
import { composeText, type MemoField } from "@/lib/memo";

type Ref = { id: string; name: string; color?: string | null };
type Track = Ref & { segmentId: string | null; isActive: boolean; segment?: Ref | null };
type UserRow = { id: string; name: string; email: string; role: string; isActive: boolean; directorateId: string | null; memoEditor?: boolean };
type Directorate = { id: string; name: string; isActive: boolean };
type Result = { ok: boolean; status: number; data: { error?: string } | null };
type Act = (p: Promise<Result>, okText?: string) => Promise<void>;

type SectionKey = "users" | "directorates" | "memo" | "columns" | "segments" | "tracks" | "statuses" | "attractiveness";
type ColumnRow = { id: string; name: string; type: "TEXT" | "NUMBER" | "DATE" | "SELECT"; options: string[] };

async function send(url: string, method: string, body?: unknown): Promise<Result> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

export default function SettingsPage() {
  const [me, setMe] = useState<{ id?: string; role: string } | null | undefined>(undefined);
  const [section, setSection] = useState<SectionKey>("users");
  const [segments, setSegments] = useState<Ref[]>([]);
  const [statuses, setStatuses] = useState<Ref[]>([]);
  const [attractiveness, setAttractiveness] = useState<Ref[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [directorates, setDirectorates] = useState<Directorate[]>([]);
  const [currentDirectorate, setCurrentDirectorate] = useState<string | null>(null);
  const [memoCount, setMemoCount] = useState(0);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const reload = useCallback(async () => {
    const get = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : null));
    const [m, s, st, a, t, u, cols, dirs, memo] = await Promise.all([
      get("/api/auth/me"),
      get("/api/segments"),
      get("/api/statuses"),
      get("/api/attractiveness"),
      get("/api/tracks?all=1"),
      get("/api/users?all=1"),
      get("/api/columns"),
      get("/api/directorates"),
      get("/api/memo-sections"),
    ]);
    setMe(m?.user ?? null);
    setSegments(s?.segments ?? []);
    setStatuses(st?.statuses ?? []);
    setAttractiveness(a?.attractiveness ?? []);
    setTracks(t?.tracks ?? []);
    setUsers(u?.users ?? []);
    setColumns(cols?.columns ?? []);
    setDirectorates(dirs?.directorates ?? []);
    setCurrentDirectorate(dirs?.current ?? null);
    setMemoCount(memo?.sections?.length ?? 0);
  }, []);

  useEffect(() => {
    reload();
    if (window.location.hash === "#columns") setSection("columns");
  }, [reload]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(t);
  }, [message]);

  const act: Act = async (promise, okText) => {
    const r = await promise;
    if (r.ok) {
      clearBootstrap(); // справочники изменились — таблица должна перечитать их
      if (okText) setMessage({ text: okText, tone: "ok" });
      await reload();
    } else {
      const e = r.data?.error;
      setMessage({
        tone: "error",
        text:
          e === "NAME_TAKEN" ? "Такое название уже есть."
          : e === "HAS_ITEMS" ? "За человеком закреплены позиции: сначала передайте их другому."
          : e === "LAST_DIRECTORATE" ? "Нельзя отключить последнюю активную дирекцию."
          : e === "EMAIL_TAKEN" ? "Такой e-mail уже зарегистрирован."
          : e === "CANNOT_DEMOTE_SELF" ? "Нельзя отключить себя или снять с себя роль: это может сделать другой админ."
          : e === "LAST_ADMIN" ? "Нельзя снять последнего админа: в системе должен остаться хотя бы один."
          : r.status === 403 ? "Недостаточно прав."
          : "Не удалось выполнить действие.",
      });
    }
  };

  if (me === undefined) return <div className="p-6"><div className="skeleton h-6 w-1/3 rounded" /></div>;
  const isAdmin = me?.role === "SYSTEM_ADMIN" || me?.role === "ADMIN";
  if (!isAdmin && me?.role !== "DIRECTOR") {
    return <div className="px-6 py-10 text-[13px] text-on-surface-variant">Настройки доступны директору и админу.</div>;
  }

  // Директор ведёт руководителей, треки и колонки таблицы; остальные справочники и роли — админ.
  const allSections: Array<{ key: SectionKey; label: string; icon: ReactNode; count: number; adminOnly?: boolean }> = [
    { key: "users", label: isAdmin ? "Пользователи" : "Ответственные", icon: <Users size={16} />, count: users.length },
    { key: "directorates", label: "Дирекции", icon: <Building2 size={16} />, count: directorates.length, adminOnly: true },
    { key: "memo", label: "Вид справки", icon: <FileText size={16} />, count: memoCount },
    { key: "columns", label: "Колонки таблицы", icon: <Columns3 size={16} />, count: columns.length },
    { key: "segments", label: "Сегменты", icon: <Layers size={16} />, count: segments.length },
    { key: "tracks", label: "Треки", icon: <Route size={16} />, count: tracks.length },
    { key: "statuses", label: "Статусы", icon: <ListChecks size={16} />, count: statuses.length, adminOnly: true },
    { key: "attractiveness", label: "Привлекательность", icon: <Star size={16} />, count: attractiveness.length, adminOnly: true },
  ];
  // Директор ведёт колонки таблицы, руководителей и треки; админ — всё.
  const sections = allSections.filter((s) => isAdmin || !s.adminOnly);

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-outline-variant bg-surface-low md:flex">
        <div className="border-b border-outline-variant bg-surface px-4 py-3">
          <span className="label-caps">Настройки</span>
        </div>
        <nav className="space-y-1 p-3">
          {sections.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] font-semibold transition-colors ${
                section === s.key ? "bg-primary-soft text-primary" : "text-on-surface-variant hover:bg-surface-high hover:text-on-surface"
              }`}
            >
              {s.icon}
              <span className="flex-1">{s.label}</span>
              <span className="text-[11px] font-bold opacity-70">{s.count}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="min-w-0 flex-1 overflow-auto p-6">
        <select value={section} onChange={(e) => setSection(e.target.value as SectionKey)} className="select mb-4 w-full md:hidden">
          {sections.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>

        {message && (
          <p className={`animate-fade-in mb-4 rounded-md border px-3 py-2 text-[13px] ${message.tone === "ok" ? "border-status-emerald/30 bg-status-emerald/10 text-emerald-800" : "border-status-red/30 bg-status-red/10 text-status-red"}`}>
            {message.text}
          </p>
        )}

        {section === "users" && <UsersSection users={users} act={act} isAdmin={isAdmin} directorates={directorates} currentDirectorate={currentDirectorate} />}
        {section === "directorates" && <DirectoratesSection directorates={directorates} act={act} />}
        {section === "memo" && <MemoStructureSection act={act} />}
        {section === "columns" && <ColumnsSettings />}
        {section === "tracks" && <TracksSection tracks={tracks} segments={segments} act={act} />}
        {section === "segments" && (
          <RefSection title="Сегменты" hint="Левая колонка таблицы вашей дирекции. Не удаляются: сегмент можно только добавить." items={segments} onAdd={(name) => act(send("/api/segments", "POST", { name }), "Сегмент добавлен.")} />
        )}
        {section === "statuses" && <RefSection title="Статусы" hint="Значения колонки «Статус»." items={statuses} onAdd={(name) => act(send("/api/statuses", "POST", { name }), "Статус добавлен.")} />}
        {section === "attractiveness" && (
          <RefSection title="Привлекательность" hint="Шкала P100 / P70 / P50 / P10 / P0." items={attractiveness} onAdd={(name) => act(send("/api/attractiveness", "POST", { name }), "Значение добавлено.")} />
        )}
      </section>
    </div>
  );
}

function SectionHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-2xl font-semibold leading-8 text-on-surface">{title}</h2>
        {hint && <p className="text-[13px] text-on-surface-variant">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-status-emerald/15 text-emerald-700" : "bg-surface-highest text-on-surface-variant"}`}>
      {active ? "Активен" : "Отключён"}
    </span>
  );
}

function UsersSection({ users, act, isAdmin, directorates, currentDirectorate }: { users: UserRow[]; act: Act; isAdmin: boolean; directorates: Directorate[]; currentDirectorate: string | null }) {
  const dirName = (id: string | null) => directorates.find((d) => d.id === id)?.name;
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const patch = (id: string, body: Record<string, unknown>, okText?: string) => act(send(`/api/users/${id}`, "PATCH", body), okText);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) : users;
  }, [users, query]);

  return (
    <>
      <SectionHeader
        title={isAdmin ? "Пользователи" : "Руководители"}
        hint={isAdmin ? "Роли назначаются здесь. Руководитель правит только свои позиции, директор — все в своей дирекции; директоров и ЗГД назначает админ." : "Добавляйте, переименовывайте и отключайте руководителей. Отключённый не удаляется: его позиции и история сохраняются."}
        action={
          <button onClick={() => setCreating(true)} className="btn-primary">
            <Plus size={16} />
            {isAdmin ? "Добавить пользователя" : "Добавить руководителя"}
          </button>
        }
      />
      <div className="relative mb-3 max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по имени или e-mail" className="input w-full pl-9" />
      </div>

      <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-sm">
        <table className="w-full table-fixed border-collapse text-[13px]">
          <thead className="bg-surface-high">
            <tr>
              {["Пользователь", "Роль", "Статус", ""].map((h, i) => (
                <th key={i} className="label-caps border-b border-outline-variant px-4 py-3 text-left" style={{ color: "var(--on-surface-variant)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className={`border-t border-outline-variant/50 ${u.isActive ? "" : "opacity-60"}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={u.name} size={30} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-on-surface">{u.name}</p>
                      <p className="truncate text-[12px] text-on-surface-variant">{u.email}{isAdmin && directorates.length > 1 && ` · ${dirName(u.directorateId) ?? "без дирекции"}`}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {isAdmin ? (
                    <select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value }, "Роль изменена.")} className="select w-full">
                      {Object.entries(ROLE_LABEL).filter(([k]) => k !== "SYSTEM_ADMIN" || u.role === "SYSTEM_ADMIN").map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-on-surface-variant">{ROLE_LABEL[u.role] ?? u.role}</span>
                  )}
                </td>
                <td className="px-4 py-3"><ActiveBadge active={u.isActive} /></td>
                <td className="px-4 py-3">
                  {isAdmin || u.role === "HEAD" ? (
                  <div className="flex items-center justify-end gap-1.5">
                    {resetFor === u.id ? (
                      <>
                        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Новый пароль (8+)" className="input h-8 w-36" />
                        <button
                          disabled={newPassword.length < 8}
                          onClick={async () => { await patch(u.id, { password: newPassword }, "Пароль изменён."); setResetFor(null); setNewPassword(""); }}
                          className="btn-primary h-8"
                        >
                          OK
                        </button>
                      </>
                    ) : (
                      <>
                        {isAdmin && (u.role === "HEAD" ? (
                          <button
                            onClick={() => patch(u.id, { memoEditor: !u.memoEditor }, u.memoEditor ? "Снят с составления справки." : "Назначен составителем справки.")}
                            className={`btn-icon h-8 w-8 ${u.memoEditor ? "bg-primary-soft text-primary" : ""}`}
                            title={u.memoEditor ? "Снять с составления справки" : "Назначить составителем справки"}
                            aria-label={u.memoEditor ? "Снять с составления справки" : "Назначить составителем справки"}
                          >
                            <FileText size={15} />
                          </button>
                        ) : u.role === "DIRECTOR" || u.role === "ADMIN" ? (
                          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary opacity-70" title="Составляет справку по должности — отдельно назначать не нужно">
                            <FileText size={15} />
                          </span>
                        ) : null)}
                        <button
                          onClick={() => {
                            const name = window.prompt("Имя (Фамилия И.О.)", u.name)?.trim();
                            if (name && name !== u.name) patch(u.id, { name }, "Имя изменено.");
                          }}
                          className="btn-icon h-8 w-8"
                          title="Изменить имя"
                        >
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => { setResetFor(u.id); setNewPassword(""); }} className="btn-icon h-8 w-8" title="Сменить пароль"><KeyRound size={15} /></button>
                        <button onClick={() => patch(u.id, { isActive: !u.isActive })} className="btn-ghost h-8">{u.isActive ? "Отключить" : "Включить"}</button>
                      </>
                    )}
                  </div>
                  ) : (
                    <div className="flex justify-end">
                      <span className="text-[12px] text-outline">Директоров и админов ведёт админ</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-[13px] text-outline">Пользователи не найдены.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && <CreateUserPanel act={act} isAdmin={isAdmin} directorates={directorates} currentDirectorate={currentDirectorate} onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateUserPanel({ act, isAdmin, directorates, currentDirectorate, onClose }: { act: Act; isAdmin: boolean; directorates: Directorate[]; currentDirectorate: string | null; onClose: () => void }) {
  const [directorateId, setDirectorateId] = useState(currentDirectorate ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("HEAD");
  const valid = name.trim() && /^\S+@\S+\.\S+$/.test(email) && password.length >= 8;

  return (
    <Panel
      title={isAdmin ? "Новый пользователь" : "Новый руководитель"}
      subtitle="Самостоятельной регистрации нет — доступ выдаёт админ или директор"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button
            disabled={!valid}
            onClick={async () => { await act(send("/api/users", "POST", { name: name.trim(), email, password, role, ...(isAdmin && role !== "EXECUTIVE" ? { directorateId: directorateId || null } : {}) }), "Пользователь создан."); onClose(); }}
            className="btn-primary"
          >
            Создать
          </button>
          <button onClick={onClose} className="btn-ghost">Отмена</button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <FormField label="Имя *"><input value={name} onChange={(e) => setName(e.target.value)} className="input w-full" placeholder="Фамилия И.О." /></FormField>
        <FormField label="E-mail *"><input value={email} onChange={(e) => setEmail(e.target.value)} className="input w-full" /></FormField>
        <FormField label="Пароль * (не короче 8 символов)"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input w-full" /></FormField>
        {isAdmin && (
        <FormField label="Роль">
          <select value={role} onChange={(e) => setRole(e.target.value)} className="select w-full">
            {Object.entries(ROLE_LABEL).filter(([k]) => k !== "SYSTEM_ADMIN").map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </FormField>
        )}
        {isAdmin && role !== "EXECUTIVE" && directorates.length > 0 && (
          <FormField label="Дирекция">
            <select value={directorateId} onChange={(e) => setDirectorateId(e.target.value)} className="select w-full">
              {directorates.filter((d) => d.isActive).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </FormField>
        )}
      </div>
    </Panel>
  );
}

type MemoSample = { title: string; comment: string | null; segmentName: string | null; trackName: string | null; ownerName: string | null; deadline: string | null; statusName: string | null; cost: string | null; attractivenessName: string | null; custom: Record<string, string> };

/**
 * Вид справки: как разделить справку на разделы и какие столбцы таблицы попадают в текст пункта.
 * Список столбцов берётся из вашей таблицы: убрали или добавили столбец в таблице — он так же пропал или появился здесь.
 */
function MemoStructureSection({ act }: { act: Act }) {
  const [shortName, setShortName] = useState("");
  const [groupBy, setGroupBy] = useState<"track" | "segment">("track");
  const [fields, setFields] = useState<MemoField[]>(["comment"]);
  const [options, setOptions] = useState<Array<{ key: MemoField; label: string }>>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [sample, setSample] = useState<MemoSample | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/memo-sections")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setShortName(d.shortName ?? "");
        setGroupBy(d.config.groupBy === "segment" ? "segment" : "track");
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

  const save = () =>
    act(send("/api/memo-sections", "PUT", { shortName: shortName.trim() || null, config: { groupBy, fields } }), "Вид справки сохранён. Он применяется к новым оперативкам и к кнопке «Обновить из данных».");

  if (!loaded) return <div className="skeleton h-40 rounded-lg" />;
  const preview = sample ? composeText(sample, fields, labels) : "Пример появится, когда в таблице будут строки.";

  return (
    <>
      <SectionHeader
        title="Вид справки"
        hint="Что из таблицы попадает в справку для ЗГД. Отметьте нужные столбцы — ниже сразу виден пример на реальной строке."
        action={
          <button onClick={save} className="btn-primary">
            Сохранить
          </button>
        }
      />

      <h3 className="label-caps mb-2">Разделы справки</h3>
      <div className="mb-6 flex max-w-2xl flex-wrap gap-2">
        {([
          ["track", "По трекам"],
          ["segment", "По сегментам"],
        ] as const).map(([k, label]) => (
          <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-semibold ${groupBy === k ? "border-primary bg-primary-soft text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-low"}`}>
            <input type="radio" name="groupBy" checked={groupBy === k} onChange={() => setGroupBy(k)} className="accent-primary" />
            {label}
          </label>
        ))}
      </div>

      <h3 className="label-caps mb-2">Столбцы таблицы в тексте пункта</h3>
      <div className="mb-3 flex max-w-2xl flex-wrap gap-2">
        {options.map((f) => (
          <label key={f.key} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] ${fields.includes(f.key) ? "border-primary bg-primary-soft text-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-low"}`}>
            <input type="checkbox" checked={fields.includes(f.key)} onChange={() => toggle(f.key)} className="accent-primary" />
            {f.label}
          </label>
        ))}
      </div>
      <div className="mb-6 max-w-2xl rounded-md border border-outline-variant bg-surface-low px-4 py-3">
        <p className="label-caps mb-1">Так будет выглядеть пункт</p>
        <p className="text-[14px] leading-[1.55] text-on-surface">• {preview}</p>
        <p className="mt-1 text-[11px] text-on-surface-variant">Если комментария нет, вместо него берётся название задачи. Готовый текст всегда можно поправить в редакторе справки.</p>
      </div>

      <div className="max-w-md">
        <label className="mb-1 block text-[12px] font-medium text-on-surface-variant">Короткое название дирекции для заголовка</label>
        <input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Например: РФ и КЭ" className="input w-full" maxLength={60} />
        <p className="mt-1 text-[12px] text-on-surface-variant">Заголовок: «Статус текущих задач по дирекции {shortName.trim() || "…"} к ОС 21.09.2026».</p>
      </div>
    </>
  );
}

function DirectoratesSection({ directorates, act }: { directorates: Directorate[]; act: Act }) {
  const [name, setName] = useState("");
  return (
    <>
      <SectionHeader title="Дирекции" hint="У каждой дирекции свои люди, сегменты, треки, колонки и оперативки. Отключённая дирекция не удаляется: данные сохраняются." />
      <div className="mb-4 flex max-w-xl gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название новой дирекции" className="input flex-1" maxLength={120} />
        <button
          disabled={name.trim().length < 2}
          onClick={async () => {
            await act(send("/api/directorates", "POST", { name: name.trim() }), "Дирекция добавлена.");
            setName("");
          }}
          className="btn-primary"
        >
          <Plus size={16} />
          Добавить
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-sm">
        <table className="w-full table-fixed border-collapse text-[13px]">
          <tbody>
            {directorates.map((d) => (
              <tr key={d.id} className={`border-t border-outline-variant/50 first:border-t-0 ${d.isActive ? "" : "opacity-60"}`}>
                <td className="px-4 py-3 font-semibold text-on-surface">{d.name}</td>
                <td className="w-28 px-4 py-3"><ActiveBadge active={d.isActive} /></td>
                <td className="w-56 px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    <button
                      onClick={() => {
                        const next = window.prompt("Название дирекции", d.name)?.trim();
                        if (next && next !== d.name) act(send(`/api/directorates/${d.id}`, "PATCH", { name: next }), "Название изменено.");
                      }}
                      className="btn-icon h-8 w-8"
                      title="Переименовать"
                    >
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => act(send(`/api/directorates/${d.id}`, "PATCH", { isActive: !d.isActive }))} className="btn-ghost h-8">
                      {d.isActive ? "Отключить" : "Включить"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-on-surface-variant">{label}</label>
      {children}
    </div>
  );
}

function AddRow({ placeholder, onAdd, extra }: { placeholder: string; onAdd: (name: string) => void; extra?: ReactNode }) {
  const [value, setValue] = useState("");
  return (
    <div className="mb-3 flex max-w-xl gap-2">
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="input flex-1" onKeyDown={(e) => e.key === "Enter" && value.trim() && (onAdd(value.trim()), setValue(""))} />
      {extra}
      <button disabled={!value.trim()} onClick={() => { onAdd(value.trim()); setValue(""); }} className="btn-primary">
        <Plus size={16} />
        Добавить
      </button>
    </div>
  );
}

function ListCard({ children, empty }: { children: ReactNode; empty?: string }) {
  return (
    <ul className="max-w-xl divide-y divide-outline-variant/60 overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-sm">
      {children}
      {empty && <li className="px-4 py-8 text-center text-[13px] text-outline">{empty}</li>}
    </ul>
  );
}

function TracksSection({ tracks, segments, act }: { tracks: Track[]; segments: Ref[]; act: Act }) {
  const [segmentId, setSegmentId] = useState("");
  return (
    <>
      <SectionHeader title="Треки" hint="Добавляйте, меняйте и удаляйте треки. Трек можно привязать к сегменту — тогда в форме позиции он предлагается для этого сегмента." />
      <AddRow
        placeholder="Новый трек"
        onAdd={(name) => act(send("/api/tracks", "POST", { name, segmentId: segmentId || null }), "Трек добавлен.")}
        extra={
          <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} className="select">
            <option value="">Без сегмента</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        }
      />
      <ListCard empty={tracks.length === 0 ? "Треков пока нет." : undefined}>
        {tracks.map((t) => (
          <TrackItem key={t.id} track={t} segments={segments} act={act} />
        ))}
      </ListCard>
    </>
  );
}

/** Строка трека: карандаш — изменить название и сегмент, корзина — удалить (с подтверждением в строке). */
function TrackItem({ track: t, segments, act }: { track: Track; segments: Ref[]; act: Act }) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [name, setName] = useState(t.name);
  const [segmentId, setSegmentId] = useState(t.segmentId ?? "");

  return (
    <li className={`px-4 py-2.5 ${t.isActive ? "" : "opacity-60"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-on-surface">{t.name}</p>
          <p className="text-[12px] text-on-surface-variant">
            {t.segment?.name ?? "Без сегмента"}
            {!t.isActive && " · скрыт"}
          </p>
        </div>
        {mode === "view" && (
          <div className="flex shrink-0 items-center gap-1">
            {!t.isActive && (
              <button onClick={() => act(send(`/api/tracks/${t.id}`, "PATCH", { isActive: true }), "Трек возвращён.")} className="btn-ghost h-8">Вернуть</button>
            )}
            <button onClick={() => { setName(t.name); setSegmentId(t.segmentId ?? ""); setMode("edit"); }} className="btn-icon h-8 w-8" title="Изменить" aria-label="Изменить">
              <Pencil size={15} />
            </button>
            <button onClick={() => setMode("delete")} className="btn-icon h-8 w-8 text-status-red" title="Удалить" aria-label="Удалить">
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>

      {mode === "edit" && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="input min-w-48 flex-1" />
          <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} className="select">
            <option value="">Без сегмента</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            disabled={!name.trim()}
            onClick={async () => { await act(send(`/api/tracks/${t.id}`, "PATCH", { name: name.trim(), segmentId: segmentId || null }), "Трек изменён."); setMode("view"); }}
            className="btn-primary h-9"
          >
            Сохранить
          </button>
          <button onClick={() => setMode("view")} className="btn-ghost h-9">Отмена</button>
        </div>
      )}

      {mode === "delete" && (
        <div className="mt-2.5 rounded-md border border-status-red/30 bg-status-red/5 p-3">
          <p className="text-[13px] text-on-surface">Удалить трек «{t.name}»?</p>
          <p className="mt-0.5 text-[12px] text-on-surface-variant">Если на трек ссылаются позиции, он будет скрыт, а в этих позициях останется.</p>
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={async () => {
                const r = await send(`/api/tracks/${t.id}`, "DELETE");
                await act(Promise.resolve(r), r.data && (r.data as { mode?: string }).mode === "hidden" ? "Трек используется в позициях, поэтому скрыт." : "Трек удалён.");
                setMode("view");
              }}
              className="btn-primary h-8 bg-status-red hover:bg-status-red"
            >
              Да, удалить
            </button>
            <button onClick={() => setMode("view")} className="btn-ghost h-8">Отмена</button>
          </div>
        </div>
      )}
    </li>
  );
}

function RefSection({ title, hint, items, onAdd }: { title: string; hint: string; items: Ref[]; onAdd: (name: string) => void }) {
  return (
    <>
      <SectionHeader title={title} hint={hint} />
      <AddRow placeholder="Новое значение" onAdd={onAdd} />
      <ListCard>
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-semibold text-on-surface">
            {i.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />}
            {i.name}
          </li>
        ))}
      </ListCard>
    </>
  );
}
