"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

type Ref = { id: string; name: string };

type Track = {
  id: string;
  name: string;
  description: string | null;
  operFlag: boolean;
  segment: Ref | null;
  status: Ref | null;
  statusId: string | null;
  attractiveness: Ref | null;
  owner: { id: string; name: string } | null;
  tasks: Array<{
    id: string;
    title: string;
    deadline: string | null;
    status: Ref | null;
    owner: { id: string; name: string } | null;
    comment: string | null;
  }>;
  vesselOptions: Array<{
    id: string;
    name: string;
    cost: string | null;
    status: Ref | null;
    attractiveness: Ref | null;
    comment: string | null;
  }>;
};

type AuditEvent = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  fieldName: string | null;
  before: string | null;
  after: string | null;
  timestamp: string;
  actor: { name: string } | null;
};

type UserRef = { id: string; name: string; role: string };

export default function TrackDetailPage() {
  const params = useParams<{ id: string }>();
  const [track, setTrack] = useState<Track | null>(null);
  const [statuses, setStatuses] = useState<Ref[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [history, setHistory] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [trackRes, statusesRes, auditRes, usersRes, meRes] = await Promise.all([
      fetch(`/api/tracks/${params.id}`),
      fetch("/api/statuses"),
      fetch(`/api/audit?entityType=Track&entityId=${params.id}`),
      fetch("/api/users"),
      fetch("/api/auth/me"),
    ]);
    if (trackRes.ok) setTrack((await trackRes.json()).track);
    if (statusesRes.ok) setStatuses((await statusesRes.json()).statuses);
    if (auditRes.ok) setHistory((await auditRes.json()).events);
    if (usersRes.ok) setUsers((await usersRes.json()).users);
    if (meRes.ok) setMe((await meRes.json()).user);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(statusId: string) {
    setError(null);
    const res = await fetch(`/api/tracks/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusId }),
    });
    if (!res.ok) {
      setError("Не удалось сохранить изменения. Данные не потеряны. Попробуйте ещё раз.");
      return;
    }
    load();
  }

  async function changeOwner(ownerId: string) {
    setError(null);
    const res = await fetch(`/api/tracks/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: ownerId || null }),
    });
    if (!res.ok) {
      setError("Не удалось сохранить изменения. Данные не потеряны. Попробуйте ещё раз.");
      return;
    }
    load();
  }

  if (loading) return <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-neutral-500">Загрузка…</div>;
  if (!track) return <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-neutral-500">Трек не найден.</div>;

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <h1 className="text-xl font-semibold">{track.name}</h1>
      {track.description && <p className="mt-1 text-sm text-neutral-600">{track.description}</p>}

      <div className="mt-4 grid grid-cols-2 gap-4 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-4">
        <Field label="Сегмент">{track.segment?.name ?? "—"}</Field>
        <Field label="Привлекательность">{track.attractiveness?.name ?? "—"}</Field>
        <Field label="Ответственный">
          {me?.role === "CURATOR" ? (
            <select
              value={track.owner?.id ?? ""}
              onChange={(e) => changeOwner(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
            >
              <option value="">Без ответственного</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          ) : (
            track.owner?.name ?? "—"
          )}
        </Field>
        <Field label="Статус">
          <select
            value={track.statusId ?? ""}
            onChange={(e) => changeStatus(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          >
            <option value="">—</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <Section title="Задачи">
        {track.tasks.length === 0 ? (
          <EmptyState text="У этого трека пока нет задач." />
        ) : (
          <ul className="divide-y divide-neutral-100">
            {track.tasks.map((t) => (
              <li key={t.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>{t.title}</span>
                  <span className="text-neutral-500">{t.status?.name ?? "—"}</span>
                </div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {t.owner?.name ?? "Без ответственного"} ·{" "}
                  {t.deadline ? new Date(t.deadline).toLocaleDateString("ru-RU") : "без срока"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Варианты судов">
        {track.vesselOptions.length === 0 ? (
          <EmptyState text="У этого трека пока нет вариантов судов." />
        ) : (
          <ul className="divide-y divide-neutral-100">
            {track.vesselOptions.map((v) => (
              <li key={v.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>{v.name}</span>
                  <span className="text-neutral-500">{v.status?.name ?? "—"}</span>
                </div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {v.cost ?? "стоимость не указана"} · {v.attractiveness?.name ?? "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="История изменений">
        {history.length === 0 ? (
          <EmptyState text="Изменений пока нет." />
        ) : (
          <ul className="space-y-1.5">
            {history.map((h) => (
              <li key={h.id} className="text-xs text-neutral-600">
                <span className="text-neutral-400">{new Date(h.timestamp).toLocaleString("ru-RU")}</span>{" "}
                — {h.actor?.name ?? "система"} · {h.action}
                {h.fieldName && (
                  <>
                    {" "}
                    ({h.fieldName}: {h.before ?? "—"} → {h.after ?? "—"})
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">{title}</h2>
      <div className="rounded-xl border border-neutral-200 bg-white p-4">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-neutral-400">{text}</p>;
}
