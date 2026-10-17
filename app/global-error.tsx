"use client";

import { useEffect } from "react";
import { reportClientError } from "@/components/ErrorReporter";

// Сломалась сама оболочка сайта (шапка, меню): страница целиком своя, без стилей приложения.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError(error), [error]);
  return (
    <html lang="ru">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", background: "#f3f4f9", color: "#191c20" }}>
        <main style={{ maxWidth: "22rem", padding: "1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.1rem", margin: "0 0 .5rem" }}>Что-то пошло не так</h1>
          <p style={{ margin: "0 0 1rem", color: "#5b6270", fontSize: ".9rem" }}>Сайт не смог открыться. Данные не потеряны — попробуйте ещё раз. Сообщение об ошибке уже отправлено.</p>
          <button onClick={reset} style={{ border: 0, borderRadius: ".5rem", background: "#0059a5", color: "#fff", padding: ".6rem 1.2rem", fontSize: ".95rem" }}>
            Повторить
          </button>
        </main>
      </body>
    </html>
  );
}
