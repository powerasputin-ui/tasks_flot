"use client";

import { useCallback, useEffect, useState } from "react";

type Ref = { id: string; name: string };
type Department = Ref & { isActive: boolean };
type Track = Ref & { segmentId: string | null; isActive: boolean; segment?: Ref | null };
type UserRow = { id: string; name: string; email: string; role: string; departmentId: string | null; isActive: boolean };

const ROLE_LABEL: Record<string, string> = {
  DEPARTMENT_HEAD: "Руководитель подразделения",
  CURATOR: "Куратор",
  MANAGEMENT: "Руководство",
  SYSTEM_ADMIN: "Администратор",
};

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

export default function SettingsPage() {
  const [me, setMe] = useState<{ role: string } | null | undefined>(undefined);
  const [segments, setSegments] = useState<Ref[]>([]);
  const [statuses, setStatuses] = useState<Ref[]>([]);
  const [attractiveness, setAttractiveness] = useState<Ref[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const get = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : null));
    const [m, s, st, a, d, t, u] = await Promise.all([
      get("/api/auth/me"),
      get("/api/segments"),
      get("/api/statuses"),
      get("/api/attractiveness"),
      get("/api/departments?all=1"),
      get("/api/tracks?all=1"),
      get("/api/users?all=1"),
    ]);
    setMe(m?.user ?? null);
    setSegments(s?.segments ?? []);
    setStatuses(st?.statuses ?? []);
    setAttractiveness(a?.attractiveness ?? []);
    setDepartments(d?.departments ?? []);
    setTracks(t?.tracks ?? []);
    setUsers(u?.users ?? []);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function act(promise: Promise<{ ok: boolean; status: number; data: { error?: string } | null }>, okText?: string) {
    const r = await promise;
    if (r.ok) {
      setMessage(okText ?? null);
      await reload();
    } else {
      const e = r.data?.error;
      setMessage(
        e === "NAME_TAKEN" ? "Такое название уже есть." : e === "EMAIL_TAKEN" ? "Такой e-mail уже зарегистрирован." : e === "CANNOT_DEMOTE_SELF" ? "Нельзя отключить себя или снять со себя роль администратора." : r.status === 403 ? "Недостаточно прав." : "Не удалось выполнить действие."
      );
    }
  }

  if (me === undefined) return <div className="w-full px-6 py-6"><div className="skeleton h-6 w-1/3 rounded" /></div>;
  if (me?.role !== "SYSTEM_ADMIN") {
    return <div className="w-full px-6 py-10 text-[13px] text-neutral-500">Настройки доступны только администратору системы.</div>;
  }

  return (
    <div className="w-full px-6 py-6">
      <div className="animate-fade-in mb-6">
        <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Настройки</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">Пользователи, роли, подразделения и справочники. Справочники не удаляются, а отключаются.</p>
      </div>
      {message && <p className="animate-fade-in mb-4 rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-800">{message}</p>}

      <UsersBlock users={users} departments={departments} act={act} />
      <DepartmentsBlock departments={departments} act={act} />
      <TracksBlock tracks={tracks} segments={segments} act={act} />
      <RefList title="Сегменты" items={segments} onAdd={(name) => act(send("/api/segments", "POST", { name }))} />
      <RefList title="Статусы" items={statuses} onAdd={(name) => act(send("/api/statuses", "POST", { name }))} />
      <RefList title="Привлекательность" items={attractiveness} onAdd={(name) => act(send("/api/attractiveness", "POST", { name }))} />
    </div>
  );
}

type Act = (p: Promise<{ ok: boolean; status: number; data: { error?: string } | null }>, okText?: string) => Promise<void>;

function UsersBlock({ users, departments, act }: { users: UserRow[]; departments: Department[]; act: Act }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("DEPARTMENT_HEAD");
  const [departmentId, setDepartmentId] = useState("");
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const patch = (id: string, body: Record<string, unknown>) => act(send(`/api/users/${id}`, "PATCH", body));

  return (
    <div className="surface animate-fade-in mb-6 p-5">
      <h2 className="mb-1 text-[14px] font-semibold text-neutral-800">Пользователи</h2>
      <p className="mb-3 text-[12px] text-neutral-500">Роль и подразделение назначаются здесь. Куратор — руководитель с расширенными правами.</p>
      <ul className="mb-4 divide-y divide-[var(--border)] text-[13px]">
        {users.map((u) => (
          <li key={u.id} className={`flex flex-wrap items-center gap-2 py-2 ${u.isActive ? "" : "opacity-50"}`}>
            <span className="min-w-52 flex-1 text-neutral-800">
              {u.name} <span className="text-neutral-400">({u.email})</span>
            </span>
            <select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })} className="select">
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={u.departmentId ?? ""} onChange={(e) => patch(u.id, { departmentId: e.target.value || null })} className="select">
              <option value="">Без подразделения</option>
              {departments.filter((d) => d.isActive || d.id === u.departmentId).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <button onClick={() => patch(u.id, { isActive: !u.isActive })} className="btn-ghost">{u.isActive ? "Отключить" : "Включить"}</button>
            <button onClick={() => { setResetFor(resetFor === u.id ? null : u.id); setNewPassword(""); }} className="btn-ghost">Пароль</button>
            {resetFor === u.id && (
              <span className="flex items-center gap-1">
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Новый пароль (8+)" className="input w-44" />
                <button
                  disabled={newPassword.length < 8}
                  onClick={async () => { await patch(u.id, { password: newPassword }); setResetFor(null); setNewPassword(""); }}
                  className="btn-primary"
                >
                  Сменить
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} className="input" />
        <input placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        <input placeholder="Пароль (8+)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="select">
          {Object.entries(ROLE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="select">
          <option value="">Без подразделения</option>
          {departments.filter((d) => d.isActive).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      <button
        disabled={!name.trim() || !email.trim() || password.length < 8}
        onClick={async () => {
          await act(send("/api/users", "POST", { name, email, password, role, departmentId: departmentId || null }), "Пользователь создан.");
          setName(""); setEmail(""); setPassword("");
        }}
        className="btn-primary mt-3"
      >
        Создать пользователя
      </button>
    </div>
  );
}

function DepartmentsBlock({ departments, act }: { departments: Department[]; act: Act }) {
  const [name, setName] = useState("");
  return (
    <div className="surface animate-fade-in mb-6 p-5">
      <h2 className="mb-2 text-[14px] font-semibold text-neutral-800">Подразделения</h2>
      <ul className="mb-3 divide-y divide-[var(--border)] text-[13px]">
        {departments.length === 0 && <li className="py-2 text-neutral-400">Подразделений пока нет — добавьте первое.</li>}
        {departments.map((d) => (
          <li key={d.id} className={`flex items-center justify-between py-1.5 ${d.isActive ? "" : "opacity-50"}`}>
            <span className="text-neutral-800">{d.name}</span>
            <button onClick={() => act(send(`/api/departments/${d.id}`, "PATCH", { isActive: !d.isActive }))} className="btn-ghost">
              {d.isActive ? "Отключить" : "Включить"}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новое подразделение" className="input flex-1" />
        <button
          disabled={!name.trim()}
          onClick={async () => { await act(send("/api/departments", "POST", { name: name.trim() })); setName(""); }}
          className="btn-primary"
        >
          Добавить
        </button>
      </div>
    </div>
  );
}

function TracksBlock({ tracks, segments, act }: { tracks: Track[]; segments: Ref[]; act: Act }) {
  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState("");
  return (
    <div className="surface animate-fade-in mb-6 p-5">
      <h2 className="mb-2 text-[14px] font-semibold text-neutral-800">Треки (справочник)</h2>
      <ul className="mb-3 max-h-72 divide-y divide-[var(--border)] overflow-auto text-[13px]">
        {tracks.length === 0 && <li className="py-2 text-neutral-400">Треков пока нет.</li>}
        {tracks.map((t) => (
          <li key={t.id} className={`flex items-center justify-between py-1.5 ${t.isActive ? "" : "opacity-50"}`}>
            <span className="text-neutral-800">
              {t.name} <span className="text-neutral-400">{t.segment?.name ? `· ${t.segment.name}` : ""}</span>
            </span>
            <button onClick={() => act(send(`/api/tracks/${t.id}`, "PATCH", { isActive: !t.isActive }))} className="btn-ghost">
              {t.isActive ? "Отключить" : "Включить"}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новый трек" className="input flex-1" />
        <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} className="select">
          <option value="">Без сегмента</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button
          disabled={!name.trim()}
          onClick={async () => { await act(send("/api/tracks", "POST", { name: name.trim(), segmentId: segmentId || null })); setName(""); }}
          className="btn-primary"
        >
          Добавить
        </button>
      </div>
    </div>
  );
}

function RefList({ title, items, onAdd }: { title: string; items: Ref[]; onAdd: (name: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="surface animate-fade-in mb-6 p-5">
      <h2 className="mb-2 text-[14px] font-semibold text-neutral-800">{title}</h2>
      <ul className="mb-3 divide-y divide-[var(--border)] text-[13px]">
        {items.map((i) => (
          <li key={i.id} className="py-1.5 text-neutral-800">{i.name}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Новое значение" className="input flex-1" />
        <button
          disabled={!value.trim()}
          onClick={() => { onAdd(value.trim()); setValue(""); }}
          className="btn-primary"
        >
          Добавить
        </button>
      </div>
    </div>
  );
}
