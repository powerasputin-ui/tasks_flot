"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, PeoplePicker, postJson } from "@/components/chat/shared";
import { GROUP_MAX_MEMBERS, GROUP_TITLE_MAX } from "@/lib/chat-rules";
import type { ChatPersonView, ChatThreadView } from "@/lib/chat-server";

/** Новый диалог: личный (один человек) или группа (название и участники). Кому писать — те же правила, что на сервере. */
export function NewChat({ onDirect, onGroup }: { onDirect: (p: ChatPersonView, threads: ChatThreadView[]) => void; onGroup: (threadId: string) => void }) {
  const [tab, setTab] = useState<"direct" | "group">("direct");
  const [people, setPeople] = useState<ChatPersonView[] | null>(null);
  const [threads, setThreads] = useState<ChatThreadView[]>([]);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<ChatPersonView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const [p, t] = await Promise.all([api<{ people: ChatPersonView[] }>("/api/chat/people"), api<{ threads: ChatThreadView[] }>("/api/chat")]);
      setPeople(p.ok ? p.data.people : []);
      if (t.ok) setThreads(t.data.threads);
    })();
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ threadId: string }>("/api/chat/groups", { title, memberIds: picked.map((p) => p.id) });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onGroup(r.data.threadId);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-outline-variant p-2">
        {(["direct", "group"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold ${tab === k ? "bg-primary-soft text-primary" : "text-on-surface-variant hover:bg-surface-high"}`}>
            {k === "direct" ? "Диалог" : "Группа"}
          </button>
        ))}
      </div>
      {people === null ? (
        <p className="p-4 text-[13px] text-on-surface-variant">Загружаю…</p>
      ) : tab === "direct" ? (
        <PeoplePicker people={people} selected={[]} onToggle={(p) => onDirect(p, threads)} placeholder="Кому написать: имя или дирекция" />
      ) : (
        <>
          <div className="shrink-0 space-y-2 border-b border-outline-variant p-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={GROUP_TITLE_MAX} placeholder="Название группы" className="input w-full text-[13px]" />
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {picked.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {p.name}
                    <button onClick={() => setPicked((l) => l.filter((x) => x.id !== p.id))} aria-label={`Убрать ${p.name}`}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <PeoplePicker autoFocus={false} people={people} selected={picked.map((p) => p.id)} onToggle={(p) => setPicked((l) => (l.some((x) => x.id === p.id) ? l.filter((x) => x.id !== p.id) : l.length + 1 >= GROUP_MAX_MEMBERS ? l : [...l, p]))} placeholder="Кого добавить: имя или дирекция" />
          <div className="shrink-0 space-y-1.5 border-t border-outline-variant p-2">
            <p className="text-[11px] text-on-surface-variant">Участник, которого добавят позже, увидит всю историю группы. Не для секретных сведений.</p>
            {error && <p className="text-[12px] text-status-red">{error}</p>}
            <button onClick={() => void create()} disabled={busy || !title.trim() || picked.length === 0} className="btn-primary h-8 w-full">
              {busy ? "Создаю…" : `Создать группу${picked.length ? ` (${picked.length + 1})` : ""}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
