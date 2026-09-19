"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { KeyRound, Layers, ListChecks, Plus, Route, Search, Star, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Panel } from "@/components/ui/Panel";
import { ROLE_LABEL } from "@/components/AppShell";

type Ref = { id: string; name: string; color?: string | null };
type Track = Ref & { segmentId: string | null; isActive: boolean; segment?: Ref | null };
type UserRow = { id: string; name: string; email: string; role: string; isActive: boolean };
type Result = { ok: boolean; status: number; data: { error?: string } | null };
type Act = (p: Promise<Result>, okText?: string) => Promise<void>;

type SectionKey = "users" | "segments" | "tracks" | "statuses" | "attractiveness";

async function send(url: string, method: string, body?: unknown): Promise<Result> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

export default function SettingsPage() {
  const [me, setMe] = useState<{ role: string } | null | undefined>(undefined);
  const [section, setSection] = useState<SectionKey>("users");
  const [segments, setSegments] = useState<Ref[]>([]);
  const [statuses, setStatuses] = useState<Ref[]>([]);
  const [attractiveness, setAttractiveness] = useState<Ref[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const reload = useCallback(async () => {
    const get = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : null));
    const [m, s, st, a, t, u] = await Promise.all([
      get("/api/auth/me"),
      get("/api/segments"),
      get("/api/statuses"),
      get("/api/attractiveness"),
      get("/api/tracks?all=1"),
      get("/api/users?all=1"),
    ]);
    setMe(m?.user ?? null);
    setSegments(s?.segments ?? []);
    setStatuses(st?.statuses ?? []);
    setAttractiveness(a?.attractiveness ?? []);
    setTracks(t?.tracks ?? []);
    setUsers(u?.users ?? []);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(t);
  }, [message]);

  const act: Act = async (promise, okText) => {
    const r = await promise;
    if (r.ok) {
      if (okText) setMessage({ text: okText, tone: "ok" });
      await reload();
    } else {
      const e = r.data?.error;
      setMessage({
        tone: "error",
        text:
          e === "NAME_TAKEN" ? "Такое название уже есть."
          : e === "EMAIL_TAKEN" ? "Такой e-mail уже зарегистрирован."
          : e === "CANNOT_DEMOTE_SELF" ? "Нельзя отключить себя или снять с себя роль администратора."
          : r.status === 403 ? "Недостаточно прав."
          : "Не удалось выполнить действие.",
      });
    }
  };

  if (me === undefined) return <div className="p-6"><div className="skeleton h-6 w-1/3 rounded" /></div>;
  if (me?.role !== "SYSTEM_ADMIN") {
    return <div className="px-6 py-10 text-[13px] text-on-surface-variant">Настройки доступны только администратору системы.</div>;
  }

  const sections: Array<{ key: SectionKey; label: string; icon: ReactNode; count: number }> = [
    { key: "users", label: "Пользователи", icon: <Users size={16} />, count: users.length },
    { key: "segments", label: "Сегменты", icon: <Layers size={16} />, count: segments.length },
    { key: "tracks", label: "Треки", icon: <Route size={16} />, count: tracks.length },
    { key: "statuses", label: "Статусы", icon: <ListChecks size={16} />, count: statuses.length },
    { key: "attractiveness", label: "Привлекательность", icon: <Star size={16} />, count: attractiveness.length },
  ];

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

        {section === "users" && <UsersSection users={users} act={act} />}
        {section === "tracks" && <TracksSection tracks={tracks} segments={segments} act={act} />}
        {section === "segments" && (
          <RefSection title="Сегменты" hint="Левая колонка таблицы. Не удаляются: сегмент можно только добавить." items={segments} onAdd={(name) => act(send("/api/segments", "POST", { name }), "Сегмент добавлен.")} />
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

function UsersSection({ users, act }: { users: UserRow[]; act: Act }) {
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
        title="Пользователи"
        hint="Роли назначаются здесь. Руководитель правит только свои позиции, куратор — все."
        action={
          <button onClick={() => setCreating(true)} className="btn-primary">
            <Plus size={16} />
            Добавить пользователя
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
                      <p className="truncate text-[12px] text-on-surface-variant">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value }, "Роль изменена.")} className="select w-full">
                    {Object.entries(ROLE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3"><ActiveBadge active={u.isActive} /></td>
                <td className="px-4 py-3">
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
                        <button onClick={() => { setResetFor(u.id); setNewPassword(""); }} className="btn-icon h-8 w-8" title="Сменить пароль"><KeyRound size={15} /></button>
                        <button onClick={() => patch(u.id, { isActive: !u.isActive })} className="btn-ghost h-8">{u.isActive ? "Отключить" : "Включить"}</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-[13px] text-outline">Пользователи не найдены.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && <CreateUserPanel act={act} onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateUserPanel({ act, onClose }: { act: Act; onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("HEAD");
  const valid = name.trim() && /^\S+@\S+\.\S+$/.test(email) && password.length >= 8;

  return (
    <Panel
      title="Новый пользователь"
      subtitle="Самостоятельной регистрации нет — доступ выдаёт администратор"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button
            disabled={!valid}
            onClick={async () => { await act(send("/api/users", "POST", { name: name.trim(), email, password, role }), "Пользователь создан."); onClose(); }}
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
        <FormField label="Роль">
          <select value={role} onChange={(e) => setRole(e.target.value)} className="select w-full">
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </FormField>
      </div>
    </Panel>
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
      <SectionHeader title="Треки" hint="Справочник. Трек можно привязать к сегменту — тогда в форме позиции он предлагается для этого сегмента." />
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
          <li key={t.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${t.isActive ? "" : "opacity-60"}`}>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-on-surface">{t.name}</p>
              <p className="text-[12px] text-on-surface-variant">{t.segment?.name ?? "Без сегмента"}</p>
            </div>
            <button onClick={() => act(send(`/api/tracks/${t.id}`, "PATCH", { isActive: !t.isActive }))} className="btn-ghost h-8 shrink-0">{t.isActive ? "Отключить" : "Включить"}</button>
          </li>
        ))}
      </ListCard>
    </>
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
