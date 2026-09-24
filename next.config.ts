import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Защитные заголовки на все ответы. CSP включается только в сборке: в разработке Next держит горячую перезагрузку на eval и websocket.
// 'unsafe-inline' у скриптов нужен самому Next (встроенные данные страницы); всё остальное — только со своего адреса.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
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
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
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
