"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, LogOut, Search, Settings } from "lucide-react";
import { NotificationsBell } from "@/components/NotificationsBell";
import { Avatar } from "@/components/ui/Avatar";
import { MenuItem, Popover } from "@/components/ui/Popover";

type Me = {
  id: string;
  name: string;
  email: string;
  role: "HEAD" | "CURATOR" | "MANAGEMENT" | "SYSTEM_ADMIN";
} | null;

export const ROLE_LABEL: Record<string, string> = {
  HEAD: "Руководитель",
  CURATOR: "Куратор",
  MANAGEMENT: "Руководство",
  SYSTEM_ADMIN: "Администратор",
};

// Меню по ролям (TZ_v4, раздел 8).
export const NAV_BY_ROLE: Record<string, Array<{ href: string; label: string }>> = {
  HEAD: [
    { href: "/table", label: "Таблица" },
    { href: "/operativka", label: "Оперативка" },
    { href: "/archive", label: "Архив" },
  ],
  CURATOR: [
    { href: "/operativka", label: "Оперативка" },
    { href: "/table", label: "Общая таблица" },
    { href: "/archive", label: "Архив" },
  ],
  MANAGEMENT: [{ href: "/operativka", label: "Оперативка" }],
  SYSTEM_ADMIN: [
    { href: "/table", label: "Таблица" },
    { href: "/archive", label: "Архив" },
  ],
};

const SEARCH_PATHS = ["/table", "/archive"];

/** Поиск хранится в адресе (?q=…): таблица читает его оттуда, без связи между компонентами. */
function TopSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [value, setValue] = useState(urlQ);
  const lastPushed = useRef(urlQ);

  useEffect(() => {
    if (urlQ !== lastPushed.current) {
      lastPushed.current = urlQ;
      setValue(urlQ);
    }
  }, [urlQ]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (value === lastPushed.current) return;
      lastPushed.current = value;
      const next = new URLSearchParams(params.toString());
      if (value) next.set("q", value);
      else next.delete("q");
      router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative hidden w-72 md:block xl:w-96">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Поиск по названию, комментарию, ответственному…"
        className="input w-full pl-9"
      />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);

  useEffect(() => {
    if (pathname === "/login") return;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => setMe(d.user))
      .catch(() => setMe(null));
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (pathname === "/login") {
    return <main className="min-h-0 flex-1 overflow-auto">{children}</main>;
  }

  const nav = me ? NAV_BY_ROLE[me.role] ?? [] : [];

  return (
    <>
      <header className="z-30 flex h-16 shrink-0 items-center gap-4 border-b border-outline-variant bg-surface px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" title="ГШП Оперативка">
          <Image src="/logo.svg" alt="" width={36} height={36} className="shrink-0" priority />
          <span className="hidden text-[13px] font-bold tracking-tight text-on-surface lg:inline">ГШП ОПЕРАТИВКА</span>
        </Link>

        <nav className="flex h-full items-stretch gap-1 lg:ml-4">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center border-b-2 px-3 text-[13px] font-semibold transition-colors ${
                  active ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {SEARCH_PATHS.some((p) => pathname.startsWith(p)) && (
          <Suspense fallback={null}>
            <TopSearch />
          </Suspense>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* Сюда страницы выносят свои действия (например, экспорт таблицы) через портал. */}
          <div id="header-actions" className="flex items-center" />
          {me && <NotificationsBell />}
          {(me?.role === "SYSTEM_ADMIN" || me?.role === "CURATOR") && (
            <Link
              href="/settings"
              title="Настройки"
              className={`btn-icon ${pathname.startsWith("/settings") ? "bg-primary-soft text-primary" : ""}`}
            >
              <Settings size={18} />
            </Link>
          )}
          <span className="mx-2 h-6 w-px bg-outline-variant" />
          {me && (
            <Popover
              align="right"
              width={260}
              trigger={({ toggle }) => (
                <button onClick={toggle} className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-surface-high">
                  <Avatar name={me.name} />
                  <span className="hidden max-w-40 truncate text-[13px] font-semibold text-on-surface lg:inline">{me.name}</span>
                  <ChevronDown size={14} className="text-outline" />
                </button>
              )}
            >
              {() => (
                <div>
                  <div className="border-b border-outline-variant px-3.5 pb-2.5 pt-1.5">
                    <p className="text-[13px] font-semibold text-on-surface">{me.name}</p>
                    <p className="text-[12px] text-on-surface-variant">{ROLE_LABEL[me.role]}</p>
                  </div>
                  <MenuItem onClick={logout} icon={<LogOut size={15} />}>
                    Выйти
                  </MenuItem>
                </div>
              )}
            </Popover>
          )}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </>
  );
}
