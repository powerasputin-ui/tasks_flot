"use client";

import { useEffect } from "react";
import Link from "next/link";
import { reportClientError } from "@/components/ErrorReporter";

// Ошибка внутри страницы: вместо белого экрана — понятное сообщение и «Повторить»; сама ошибка уходит в журнал.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError(error), [error]);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-[18px] font-bold text-on-surface">Что-то пошло не так</h1>
        <p className="mt-2 text-[13px] text-on-surface-variant">Страница не смогла открыться. Данные не потеряны: попробуйте ещё раз. Мы уже получили сообщение об ошибке.</p>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={reset} className="btn-primary">
            Повторить
          </button>
          <Link href="/" className="btn-ghost">
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}
