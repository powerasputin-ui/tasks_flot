"use client";

import { useEffect, useState } from "react";
import { fetchRetry } from "@/lib/fetch-retry";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // сервер недоступен даже для простой проверки — вероятно, ограничение сети (корпоративный прокси)
  const [unreachable, setUnreachable] = useState(false);

  // будим сервер и базу, пока человек набирает логин и пароль: к нажатию «Войти» ответ придёт за секунду, а не за 15–30
  useEffect(() => {
    fetchRetry("/api/health", { cache: "no-store" }, 1000, 10000)
      .then(() => setUnreachable(false))
      .catch(() => setUnreachable(true));
  }, []);

  /** Вход с одним повтором: прокси иногда обрывает первый, долгий запрос. */
  async function postLogin(): Promise<Response> {
    const once = () =>
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        // запуск экземпляра сервера на Vercel изредка зависает — не ждём дольше 20 с, а повторяем (см. lib/fetch-retry)
        signal: AbortSignal.timeout(20000),
      });
    try {
      return await once();
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
      return once();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await postLogin();
      if (!res.ok) {
        // слишком много попыток — сервер сам пишет, через сколько можно повторить; иначе человек решит, что забыл пароль
        const d = await res.json().catch(() => null);
        setError(res.status === 429 ? d?.message ?? "Слишком много попыток входа. Попробуйте позже." : res.status === 401 || res.status === 400 ? "Неверный e-mail или пароль" : "Сервер временно недоступен. Повторите попытку.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setUnreachable(true);
      setError("Нет связи с сервером. Повторите попытку.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,_#e6f0fa,_#f4f6f9_60%)] px-4 py-10">
      <form onSubmit={handleSubmit} className="surface animate-fade-in w-full max-w-sm p-8 shadow-lg">
        <div className="mb-7 flex flex-col items-center text-center">
          <Image src="/logo.svg" alt="ГШП" width={64} height={64} priority />
          <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-on-surface">ГШП Оперативка</h1>
          <p className="mt-1 text-[13px] text-on-surface-variant">Войдите, чтобы продолжить</p>
        </div>

        <label className="mb-1 block text-[12px] font-medium text-on-surface-variant">E-mail</label>
        <input
          type="email"
          required
          autoFocus
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input mb-4 w-full"
        />

        <label className="mb-1 block text-[12px] font-medium text-on-surface-variant">Пароль</label>
        <div className="relative mb-4">
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input w-full pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-outline hover:text-on-surface"
            title={showPassword ? "Скрыть пароль" : "Показать пароль"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {error && (
          <p className="animate-fade-in mb-4 flex items-center gap-2 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-[13px] text-status-red">
            <AlertCircle size={15} className="shrink-0" />
            {error}
          </p>
        )}
        {unreachable && (
          <p className="mb-4 rounded-md border border-outline-variant bg-surface-high px-3 py-2 text-[12px] leading-snug text-on-surface-variant">
            Страница открылась, а сервер не отвечает — так бывает в корпоративной сети, когда прокси обрывает или не пропускает запросы.
            Попробуйте ещё раз через минуту; если не поможет — попросите ИТ-службу разрешить адрес <b>{typeof window !== "undefined" ? window.location.host : "tasks-flot.vercel.app"}</b> (включая отправку данных на /api/).
          </p>
        )}

        <button type="submit" disabled={loading} className="btn-primary h-10 w-full">
          {loading ? "Вход…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
