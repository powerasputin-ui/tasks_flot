import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit читает свои шрифтовые данные из node_modules во время выполнения — не бандлим его.
  serverExternalPackages: ["pdfkit"],
  // Шрифты DejaVu (кириллица для PDF) читаются по пути с диска — включаем их в serverless-функции.
  outputFileTracingIncludes: {
    "/api/export/*": ["./assets/fonts/**/*"],
    "/api/cycles/*/memo/*": ["./assets/fonts/**/*"],
  },
};

export default nextConfig;
