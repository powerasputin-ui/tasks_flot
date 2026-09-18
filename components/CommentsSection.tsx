"use client";

import { useEffect, useState } from "react";

type Comment = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string };
};

// Раздел 32 ТЗ: комментарии к Track/Task/VesselOption/WeeklyUpdate.
// entityType/entityId — полиморфная привязка, как в AuditEvent.
export function CommentsSection({
  entityType,
  entityId,
  currentUserId,
}: {
  entityType: "Track" | "Task" | "VesselOption" | "WeeklyUpdate";
  entityId: string;
  currentUserId: string;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  async function load() {
    const res = await fetch(`/api/comments?entityType=${entityType}&entityId=${entityId}`);
    if (res.ok) {
      const data = await res.json();
      setComments(data.comments);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  async function submit() {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId, text: text.trim() }),
      });
      if (res.ok) {
        setText("");
        await load();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEdit(id: string) {
    if (!editText.trim()) return;
    const res = await fetch(`/api/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: editText.trim() }),
    });
    if (res.ok) {
      setEditingId(null);
      await load();
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  return (
    <div>
      {loading ? (
        <div className="skeleton h-4 w-1/3 rounded" />
      ) : comments.length === 0 ? (
        <p className="mb-3 text-[13px] text-neutral-400">Комментариев пока нет.</p>
      ) : (
        <ul className="mb-3 divide-y divide-[var(--border)]">
          {comments.map((c) => (
            <li key={c.id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium text-neutral-800">{c.author.name}</span>
                <span className="text-[11px] text-neutral-400">{new Date(c.createdAt).toLocaleString("ru-RU")}</span>
              </div>
              {editingId === c.id ? (
                <div className="mt-1.5 flex gap-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="input flex-1"
                    rows={2}
                  />
                  <div className="flex flex-col gap-1">
                    <button onClick={() => saveEdit(c.id)} className="btn-primary px-2 py-1 text-[12px]">
                      Сохранить
                    </button>
                    <button onClick={() => setEditingId(null)} className="btn-ghost px-2 py-1 text-[12px]">
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-neutral-600">{c.text}</p>
              )}
              {c.author.id === currentUserId && editingId !== c.id && (
                <div className="mt-1 flex gap-3 text-[11px] text-neutral-400">
                  <button
                    onClick={() => {
                      setEditingId(c.id);
                      setEditText(c.text);
                    }}
                    className="hover:text-neutral-700"
                  >
                    Изменить
                  </button>
                  <button onClick={() => remove(c.id)} className="hover:text-[var(--danger)]">
                    Удалить
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Написать комментарий… (@Имя Фамилия — упомянуть)"
          className="input flex-1"
          rows={2}
        />
        <button onClick={submit} disabled={submitting || !text.trim()} className="btn-primary self-end">
          {submitting ? "Отправка…" : "Отправить"}
        </button>
      </div>
    </div>
  );
}
