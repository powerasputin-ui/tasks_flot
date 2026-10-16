"use client";

import { useEffect, useState } from "react";
import { Crown, Pencil, Plus, UserMinus } from "lucide-react";
import { api, PeoplePicker, postJson, sub } from "@/components/chat/shared";
import { PersonAvatar } from "@/components/ui/Person";
import { askConfirm, askText } from "@/components/ui/Dialog";
import { GROUP_TITLE_MAX } from "@/lib/chat-rules";
import type { ChatPersonView, ChatThreadDetail } from "@/lib/chat-server";

/** Участники группы: список, добавить (любой участник), убрать / переименовать / удалить (владелец), выйти. */
export function Members({ detail, meId, onChanged, onGone }: { detail: ChatThreadDetail; meId: string; onChanged: () => void; onGone: () => void }) {
  const [adding, setAdding] = useState(false);
  const [people, setPeople] = useState<ChatPersonView[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const task = detail.kind === "TASK";

  useEffect(() => {
    if (!adding) return;
    void (async () => {
      const r = await api<{ people: ChatPersonView[] }>("/api/chat/people");
      setPeople(r.ok ? r.data.people.filter((p) => !detail.members.some((m) => m.id === p.id)) : []);
    })();
  }, [adding, detail.members]);

  async function act(body: Record<string, unknown>, gone = false) {
    setBusy(true);
    setError(null);
    const r = await postJson<{ deleted?: boolean }>(`/api/chat/threads/${detail.id}`, body);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    if (gone || r.data.deleted) return onGone();
    setAdding(false);
    setSel([]);
    onChanged();
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-outline-variant px-3 py-2">
        <span className="text-[13px] font-bold text-on-surface">Участники ({detail.members.length})</span>
        {detail.canAdd && !adding && (
          <button onClick={() => setAdding(true)} className="btn-ghost h-7 text-[12px]">
            <Plus size={14} /> Добавить
          </button>
        )}
      </div>
      {error && <p className="shrink-0 px-3 py-1.5 text-[12px] text-status-red">{error}</p>}
      {adding ? (
        <>
          <PeoplePicker people={people ?? []} selected={sel} onToggle={(p) => setSel((l) => (l.includes(p.id) ? l.filter((x) => x !== p.id) : [...l, p.id]))} placeholder="Кого добавить: имя или дирекция" />
          <div className="shrink-0 space-y-1.5 border-t border-outline-variant p-2">
            <p className="text-[11px] text-on-surface-variant">Новый участник увидит всю историю {task ? "обсуждения" : "группы"}.</p>
            <div className="flex gap-2">
              <button onClick={() => setAdding(false)} className="btn-ghost h-8 flex-1">
                Отмена
              </button>
              <button onClick={() => void act({ action: "add", userIds: sel })} disabled={busy || sel.length === 0} className="btn-primary h-8 flex-1">
                Добавить{sel.length ? ` (${sel.length})` : ""}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {detail.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 border-b border-outline-variant/50 px-3 py-2">
                <PersonAvatar name={m.name} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate text-[13px] font-semibold text-on-surface">
                    {m.name}
                    {m.id === meId && <span className="text-[11px] font-normal text-outline">(вы)</span>}
                    {m.isOwner && <Crown size={12} className="shrink-0 text-[#b45309]" aria-label="владелец" />}
                    {!m.isActive && <span className="text-[11px] font-normal text-outline">(отключён)</span>}
                  </span>
                  <span className="block truncate text-[11px] text-on-surface-variant">{sub(m)}</span>
                </span>
                {detail.canManage && m.id !== meId && (
                  <button
                    onClick={async () => {
                      if (await askConfirm({ title: `Убрать «${m.name}» из ${task ? "обсуждения" : "группы"}?`, message: "Он сразу потеряет доступ к переписке.", okLabel: "Убрать", danger: true })) void act({ action: "remove", userId: m.id });
                    }}
                    aria-label={`Убрать ${m.name}`}
                    title="Убрать из группы"
                    className="btn-icon h-7 w-7 text-status-red"
                  >
                    <UserMinus size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex shrink-0 flex-wrap gap-2 border-t border-outline-variant p-2">
            {detail.canManage && detail.kind === "GROUP" && (
              <button
                onClick={async () => {
                  const t = await askText({ title: "Название группы", defaultValue: detail.title ?? "", required: true, maxLength: GROUP_TITLE_MAX });
                  if (t) void act({ action: "rename", title: t });
                }}
                className="btn-ghost h-8 text-[12px]"
              >
                <Pencil size={13} /> Переименовать
              </button>
            )}
            <button
              onClick={async () => {
                if (await askConfirm({ title: `Выйти из ${task ? "обсуждения" : "группы"}?`, message: detail.canManage ? "Владение перейдёт другому участнику." : undefined, okLabel: "Выйти", danger: true })) void act({ action: "leave" }, true);
              }}
              className="btn-ghost h-8 text-[12px]"
            >
              Выйти
            </button>
            {detail.canManage && (
              <button
                onClick={async () => {
                  if (await askConfirm({ title: `Удалить ${task ? "обсуждение" : "группу"}?`, message: "Вся переписка будет удалена для всех участников.", okLabel: "Удалить", danger: true })) void act({ action: "delete" }, true);
                }}
                className="btn-ghost h-8 text-[12px] text-status-red"
              >
                Удалить
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
