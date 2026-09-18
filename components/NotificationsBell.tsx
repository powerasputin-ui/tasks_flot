"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
        className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
          open ? "bg-neutral-100 text-neutral-900" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
        }`}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="animate-fade-in absolute right-0 top-10 w-80 rounded-lg border border-[var(--border)] bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <span className="text-[13px] font-medium text-neutral-800">Уведомления</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[12px] text-neutral-500 hover:text-neutral-800">
                Прочитать все
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-neutral-400">Уведомлений нет.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {notifications.map((n) => {
                  const content = (
                    <div
                      className={`px-3 py-2.5 text-[13px] ${n.isRead ? "text-neutral-500" : "bg-blue-50/50 text-neutral-800"}`}
                    >
                      <p>{n.message}</p>
                      <p className="mt-0.5 text-[11px] text-neutral-400">
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
