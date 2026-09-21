"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Eye, LogOut, Search, Settings, X } from "lucide-react";
import { NotificationsBell } from "@/components/NotificationsBell";
import { clearBootstrap, loadBootstrap } from "@/lib/client-bootstrap";
import { setPreview, usePreviewAs } from "@/lib/preview-as";
import { Avatar } from "@/components/ui/Avatar";
import { MenuItem, Popover } from "@/components/ui/Popover";

type Me = {
  id: string;
  name: string;
  email: string;
  role: "HEAD" | "DIRECTOR" | "ADMIN" | "EXECUTIVE" | "SYSTEM_ADMIN";
} | null;

export const ROLE_LABEL: Record<string, string> = {
  HEAD: "Руководитель",
  DIRECTOR: "Директор",
  ADMIN: "Админ",
  EXECUTIVE: "ЗГД",
  SYSTEM_ADMIN: "Технический администратор",
};

// Меню по ролям (TZ_v4, раздел 8).
export const NAV_BY_ROLE: Record<string, Array<{ href: string; label: string }>> = {
  HEAD: [
    { href: "/table", label: "Таблица" },
    { href: "/operativka", label: "Оперативка" },
    { href: "/archive", label: "Архив" },
  ],
  DIRECTOR: [
    { href: "/operativka", label: "Оперативка" },
    { href: "/table", label: "Общая таблица" },
    { href: "/archive", label: "Архив" },
  ],
  ADMIN: [
    { href: "/operativka", label: "Оперативка" },
    { href: "/table", label: "Общая таблица" },
    { href: "/archive", label: "Архив" },
  ],
  EXECUTIVE: [{ href: "/operativka", label: "Оперативка" }],
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
    <div className="relative hidden w-72 md:block lg:ml-4 xl:w-96">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setValue("")}
        placeholder="Поиск: задача, комментарий, трек, ответственный, статус…"
        aria-label="Поиск по таблице"
        maxLength={200}
        className="input w-full pl-9 pr-9"
      />
      {value && (
        <button onClick={() => setValue("")} className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-outline hover:bg-surface-high hover:text-on-surface" title="Очистить поиск (Esc)" aria-label="Очистить поиск">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  // руководители, глазами которых куратор может посмотреть систему
  const [heads, setHeads] = useState<Array<{ id: string; name: string }>>([]);
  const preview = usePreviewAs();

  useEffect(() => {
    if (pathname === "/login") {
      clearBootstrap(); // после входа под другим пользователем данные должны загрузиться заново
      return;
    }
    loadBootstrap().then((b) => {
      setMe((b?.user as Me) ?? null);
      setHeads((b?.users ?? []).filter((u) => u.role === "HEAD").map((u) => ({ id: u.id, name: u.name })));
    });
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearBootstrap();
    setPreview(null);
    router.push("/login");
    router.refresh();
  }

  if (pathname === "/login") {
    return <main className="min-h-0 flex-1 overflow-auto">{children}</main>;
  }

  // Режим просмотра доступен только куратору; в нём меню и кнопки такие же, как у руководителя.
  const canPreview = me?.role === "ADMIN" || me?.role === "DIRECTOR";
  const previewing = canPreview ? preview : null;
  const effRole = previewing ? "HEAD" : me?.role;
  const nav = effRole ? NAV_BY_ROLE[effRole] ?? [] : [];

  return (
    <>
      <header className="z-30 flex h-16 shrink-0 items-center gap-4 border-b border-outline-variant bg-surface px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" title="ГШП Оперативка">
          <Image src="/logo.svg" alt="" width={36} height={36} className="shrink-0" priority />
          <span className="hidden text-[13px] font-bold tracking-tight text-on-surface lg:inline">ГШП ОПЕРАТИВКА</span>
        </Link>

        {SEARCH_PATHS.some((p) => pathname.startsWith(p)) && (
          <Suspense fallback={null}>
            <TopSearch />
          </Suspense>
        )}

        <nav className="flex h-full items-stretch gap-1 lg:ml-2">
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

        <div className="ml-auto flex items-center gap-1">
          {/* Сюда страницы выносят свои действия (например, экспорт таблицы) через портал. */}
          <div id="header-actions" className="flex items-center" />
          {me && <NotificationsBell />}
          {(effRole === "SYSTEM_ADMIN" || effRole === "ADMIN" || effRole === "DIRECTOR") && (
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
                  {canPreview && (
                    <div className="border-b border-outline-variant py-1.5">
                      {previewing ? (
                        <MenuItem onClick={() => setPreview(null)} icon={<Eye size={15} />}>
                          Выйти из режима просмотра
                        </MenuItem>
                      ) : (
                        <>
                          <p className="label-caps px-3.5 pb-1 pt-1">Посмотреть как руководитель</p>
                          <div className="max-h-56 overflow-y-auto">
                            {heads.length === 0 && <p className="px-3.5 py-2 text-[12px] text-outline">Руководителей пока нет</p>}
                            {heads.map((h) => (
                              <MenuItem key={h.id} onClick={() => setPreview({ id: h.id, name: h.name })} icon={<Avatar name={h.name} size={18} />}>
                                {h.name}
                              </MenuItem>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <MenuItem onClick={logout} icon={<LogOut size={15} />}>
                    Выйти
                  </MenuItem>
                </div>
              )}
            </Popover>
          )}
        </div>
      </header>
      {previewing && (
        <div className="flex flex-wrap items-center gap-3 border-b border-primary/20 bg-primary-soft px-4 py-2 text-[13px] text-primary">
          <Eye size={15} className="shrink-0" />
          <span className="min-w-0 flex-1">
            Режим просмотра: вы видите систему глазами руководителя <strong className="font-semibold">{previewing.name}</strong>. Изменения в этом режиме не сохраняются.
          </span>
          <button onClick={() => setPreview(null)} className="btn-ghost h-8 bg-surface">
            Выйти из режима
          </button>
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </>
  );
}
