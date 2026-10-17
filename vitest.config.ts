import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    // e2e/ui — браузерные сценарии Playwright (npm run test:ui), не юнит-тесты
    exclude: ["**/node_modules/**", "e2e/ui/**"],
  },
});
