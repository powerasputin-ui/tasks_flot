"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Ref = { id: string; name: string };

export function CreateTrackForm() {
  const router = useRouter();
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [segments, setSegments] = useState<Ref[]>([]);
  const [attractiveness, setAttractiveness] = useState<Ref[]>([]);

  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [attractivenessId, setAttractivenessId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => setMe(d.user));
  }, []);

  useEffect(() => {
    if (!open) return;
    Promise.all([fetch("/api/segments").then((r) => r.json()), fetch("/api/attractiveness").then((r) => r.json())]).then(
      ([s, a]) => {
        setSegments(s.segments);
        setAttractiveness(a.attractiveness);
      }
    );
  }, [open]);

  if (me?.role !== "RESPONSIBLE") return null;

  async function submit() {
    if (!name.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), segmentId: segmentId || null, attractivenessId: attractivenessId || null }),
      });
      if (!res.ok) {
        setErr("Не удалось сохранить изменения. Данные не потеряны. Попробуйте ещё раз.");
        return;
      }
      const { track } = await res.json();
      setOpen(false);
      setName("");
      router.push(`/tracks/${track.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        + Новый трек
      </button>
    );
  }

  return (
    <div className="surface animate-fade-in mb-4 p-4">
      <input
        autoFocus
        placeholder="Название трека"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="input mb-2 w-full"
      />
      <div className="mb-2 flex flex-wrap gap-2">
        <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} className="select">
          <option value="">Сегмент —</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={attractivenessId} onChange={(e) => setAttractivenessId(e.target.value)} className="select">
          <option value="">Привлекательность —</option>
          {attractiveness.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {err && <p className="mb-2 text-[13px] text-[var(--danger)]">{err}</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={submitting || !name.trim()} className="btn-primary">
          {submitting ? "Сохранение…" : "Создать"}
        </button>
        <button onClick={() => setOpen(false)} className="btn-ghost">
          Отмена
        </button>
      </div>
    </div>
  );
}
