"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

type Notification = {
  id: string;
  type: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

export function NotificationsBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function load() {
    const res = await fetch("/api/notifications");
    if (!res.ok) return;
    const data = await res.json();
    setNotifications(data.notifications);
    setUnreadCount(data.unreadCount);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function markRead(id: string) {
    await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    });
    load();
  }

  async function markAllRead() {
    await fetch("/api/notifications/read-all", { method: "POST" });
    load();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Уведомления"
        className={`btn-icon relative ${open ? "bg-primary-soft text-primary" : ""}`}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-red px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="animate-fade-in absolute right-0 top-11 z-50 w-80 rounded-lg border border-outline-variant bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-outline-variant px-3.5 py-2.5">
            <span className="label-caps">Уведомления</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[12px] font-semibold text-primary hover:underline">
                Прочитать все
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-outline">Уведомлений нет.</p>
            ) : (
              <ul className="divide-y divide-outline-variant">
                {notifications.map((n) => {
                  const content = (
                    <div
                      className={`px-3 py-2.5 text-[13px] ${n.isRead ? "text-on-surface-variant" : "bg-primary-soft/60 text-on-surface"}`}
                    >
                      <p>{n.message}</p>
                      <p className="mt-0.5 text-[11px] text-outline">
                        {new Date(n.createdAt).toLocaleString("ru-RU")}
                      </p>
                    </div>
                  );
                  return (
                    <li key={n.id} onClick={() => !n.isRead && markRead(n.id)}>
                      {n.link ? (
                        <Link href={n.link} onClick={() => setOpen(false)} className="row-hover block">
                          {content}
                        </Link>
                      ) : (
                        <div className="row-hover cursor-pointer">{content}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
