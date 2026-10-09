import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Защитные заголовки на все ответы. CSP включается только в сборке: в разработке Next держит горячую перезагрузку на eval и websocket.
// 'unsafe-inline' у скриптов нужен самому Next (встроенные данные страницы); всё остальное — только со своего адреса.
const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' и worker из blob: — локальная модель ИИ в браузере (wllama, lib/local-ai.ts)
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // изоляция страницы: без неё локальная модель считает в один поток (в разы медленнее). Все ресурсы сайта свои — ничего не ломает
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  ...(isProd
    ? [
        { key: "Content-Security-Policy", value: CSP },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // анимация помощника не меняется — браузер держит её в кэше неделю и не перекачивает при каждом открытии
      ...["/operativshchik.webp", "/operativshchik-still.webp", "/wllama/wllama.wasm"].map((source) => ({ source, headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] })),
    ];
  },
  // pdfkit читает свои шрифтовые данные из node_modules во время выполнения — не бандлим его.
  serverExternalPackages: ["pdfkit"],
  // Шрифты DejaVu (кириллица для PDF) читаются по пути с диска — включаем их в serverless-функции.
  outputFileTracingIncludes: {
    "/api/export/*": ["./assets/fonts/**/*"],
    "/api/cycles/*/memo/*": ["./assets/fonts/**/*"],
  },
};

export default nextConfig;
