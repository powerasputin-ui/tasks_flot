"use client";

import { useState } from "react";

export function RequestEditButton({ entityType, entityId }: { entityType: "Track" | "Task" | "VesselOption"; entityId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function send() {
    if (!note.trim()) return;
    setState("sending");
    const res = await fetch("/api/edit-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType, entityId, note: note.trim() }),
    });
    if (res.ok) {
      setState("sent");
      setNote("");
      setOpen(false);
    } else setState("error");
  }

  return (
    <div className="shrink-0 text-right">
      <button onClick={() => setOpen((v) => !v)} className="btn-ghost">
        Запросить изменение
      </button>
      {open && (
        <div className="animate-fade-in mt-2 flex gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Что нужно изменить?" maxLength={500} className="input w-72" />
          <button onClick={send} disabled={state === "sending" || !note.trim()} className="btn-primary">
            Отправить
          </button>
        </div>
      )}
      {state === "sent" && <p className="mt-1 text-[12px] text-green-700">Запрос отправлен владельцу.</p>}
      {state === "error" && <p className="mt-1 text-[12px] text-[var(--danger)]">Не удалось отправить запрос.</p>}
    </div>
  );
}
