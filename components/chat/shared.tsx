"use client";

import { Check, Search, Users } from "lucide-react";
import { useState } from "react";
import { PersonAvatar } from "@/components/ui/Person";
import { stringToColor } from "@/components/ui/Avatar";
import type { ChatPersonView, ChatThreadView } from "@/lib/chat-server";

export const ROLE_LABEL: Record<string, string> = { HEAD: "руководитель", DIRECTOR: "директор", ADMIN: "админ", EXECUTIVE: "ЗГД" };

export const hm = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
export const dm = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });
export const when = (iso: string) => (dm(iso) === dm(new Date().toISOString()) ? hm(iso) : dm(iso));
export const sub = (p: ChatPersonView) => [ROLE_LABEL[p.role] ?? p.role, p.directorateName].filter(Boolean).join(" · ");

export async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; message: string; status: number }> {
  try {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    return { ok: false, status: res.status, message: body?.message ?? "Не удалось выполнить. Попробуйте ещё раз." };
  } catch {
    return { ok: false, status: 0, message: "Нет связи с сервером." };
  }
}

export const postJson = <T,>(url: string, body: unknown) => api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Круглый значок группы: цвет по названию, внутри иконка «люди». */
export function GroupAvatar({ title, size = 36 }: { title: string | null | undefined; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full text-white" style={{ width: size, height: size, background: stringToColor(title || "группа") }} aria-hidden>
      <Users size={size * 0.5} />
    </span>
  );
}

/** Аватар диалога в списке: человек — его инициал, группа и чат по задаче — значок группы. */
export function ThreadAvatar({ t, size = 36 }: { t: Pick<ChatThreadView, "kind" | "title" | "other">; size?: number }) {
  return t.other && t.kind === "DIRECT" ? <PersonAvatar name={t.other.name} size={size} /> : <GroupAvatar title={t.title} size={size} />;
}

/** Выбор людей: поиск и список с галочками (несколько) или щелчком (один человек). */
export function PeoplePicker({ people, selected, onToggle, placeholder = "Имя или дирекция", autoFocus = true }: { people: ChatPersonView[]; selected: string[]; onToggle: (p: ChatPersonView) => void; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = people.filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.directorateName ?? "").toLowerCase().includes(needle));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative border-b border-outline-variant p-2">
        <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline" />
        <input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="input w-full pl-8 text-[13px]" />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 && <li className="p-4 text-[13px] text-on-surface-variant">{people.length === 0 ? "Здесь пока никого нет." : "Никого не нашли."}</li>}
        {list.map((p) => {
          const on = selected.includes(p.id);
          return (
            <li key={p.id}>
              <button onClick={() => onToggle(p)} aria-pressed={on} className={`flex w-full items-center gap-3 border-b border-outline-variant/50 px-3 py-2 text-left hover:bg-surface-low ${on ? "bg-primary-soft/60" : ""}`}>
                <PersonAvatar name={p.name} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-on-surface">{p.name}</span>
                  <span className="block truncate text-[11px] text-on-surface-variant">{sub(p)}</span>
                </span>
                {on && <Check size={16} className="shrink-0 text-primary" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
