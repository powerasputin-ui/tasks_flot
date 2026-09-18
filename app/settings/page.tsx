"use client";

import { useEffect, useState } from "react";

type Ref = { id: string; name: string; sortOrder: number };
type UserRef = { id: string; name: string; email: string; role: string };

const ROLE_LABEL: Record<string, string> = {
  RESPONSIBLE: "Ответственный",
  CURATOR: "Куратор",
  MANAGER: "Руководитель",
};

export default function SettingsPage() {
  const [segments, setSegments] = useState<Ref[]>([]);
  const [statuses, setStatuses] = useState<Ref[]>([]);
  const [attractiveness, setAttractiveness] = useState<Ref[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  async function reload() {
    const [s, st, a, u] = await Promise.all([
      fetch("/api/segments"),
      fetch("/api/statuses"),
      fetch("/api/attractiveness"),
      fetch("/api/users"),
    ]);
    setSegments((await s.json()).segments);
    setStatuses((await st.json()).statuses);
    setAttractiveness((await a.json()).attractiveness);
    setUsers((await u.json()).users);
  }

  useEffect(() => {
    reload();
  }, []);

  async function addItem(endpoint: string, name: string) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.status === 403) {
      setForbidden(true);
      return;
    }
    await reload();
  }

  return (
    <div className="w-full px-6 py-6">
      <div className="animate-fade-in mb-6">
        <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Настройки</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          Справочники и пользователи (разделы 8-10, 34, 36 ТЗ). Управление доступно роли Куратор.
        </p>
      </div>
      {forbidden && (
        <p className="animate-fade-in mb-4 rounded-md bg-red-50 px-3 py-2 text-[13px] text-[var(--danger)]">
          У вашей роли нет прав на изменение справочников (раздел 36 ТЗ).
        </p>
      )}

      <RefList title="Сегменты" items={segments} onAdd={(name) => addItem("/api/segments", name)} />
      <RefList title="Статусы" items={statuses} onAdd={(name) => addItem("/api/statuses", name)} />
      <RefList
        title="Привлекательность"
        items={attractiveness}
        onAdd={(name) => addItem("/api/attractiveness", name)}
      />

      <UserAdmin users={users} error={userError} onCreated={reload} onForbidden={() => setForbidden(true)} onError={setUserError} />
    </div>
  );
}

function UserAdmin({
  users,
  error,
  onCreated,
  onForbidden,
  onError,
}: {
  users: UserRef[];
  error: string | null;
  onCreated: () => void;
  onForbidden: () => void;
  onError: (e: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("RESPONSIBLE");
  const [submitting, setSubmitting] = useState(false);

  async function createUser() {
    onError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      if (res.status === 403) {
        onForbidden();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        onError(body?.error === "EMAIL_TAKEN" ? "Такой email уже зарегистрирован." : "Не удалось создать пользователя.");
        return;
      }
      setName("");
      setEmail("");
      setPassword("");
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="surface animate-fade-in mb-6 p-5">
      <h2 className="mb-1 text-[14px] font-semibold text-neutral-800">Пользователи</h2>
      <p className="mb-3 text-[12px] text-neutral-500">
        Раздел 34 ТЗ: self-signup отсутствует, пользователей создаёт администратор (роль Куратор).
      </p>
      <ul className="mb-3 divide-y divide-[var(--border)] text-[13px]">
        {users.map((u) => (
          <li key={u.id} className="row-hover -mx-1 flex justify-between rounded-lg px-1 py-1.5">
            <span className="text-neutral-800">
              {u.name} <span className="text-neutral-400">({u.email})</span>
            </span>
            <span className="text-neutral-500">{ROLE_LABEL[u.role] ?? u.role}</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} className="input" />
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        <input
          placeholder="Пароль"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="select">
          <option value="RESPONSIBLE">Ответственный</option>
          <option value="CURATOR">Куратор</option>
          <option value="MANAGER">Руководитель</option>
        </select>
      </div>
      {error && <p className="mt-2 animate-fade-in text-[13px] text-[var(--danger)]">{error}</p>}
      <button onClick={createUser} disabled={submitting} className="btn-primary mt-3">
        {submitting ? "Создание…" : "Создать пользователя"}
      </button>
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
          <li key={i.id} className="row-hover -mx-1 rounded-lg px-1 py-1.5 text-neutral-800">
            {i.name}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Новое значение"
          className="input flex-1"
        />
        <button
          onClick={() => {
            if (!value.trim()) return;
            onAdd(value.trim());
            setValue("");
          }}
          className="btn-primary"
        >
          Добавить
        </button>
      </div>
    </div>
  );
}
