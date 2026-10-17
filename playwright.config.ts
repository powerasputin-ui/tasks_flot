import { defineConfig, devices } from "@playwright/test";

/**
 * Браузерные дымовые тесты интерфейса (e2e/ui). Данные и учётки создаёт global-setup на временной базе из DATABASE_URL
 * (в CI — база GitHub Actions; локально — npm run db:local). Каждый сценарий — на ширине компьютера и телефона.
 * Локально: запустите npm run dev и затем npm run test:ui (адрес — UI_BASE_URL, по умолчанию http://localhost:3000).
 * В CI: UI_START=1 — Playwright сам запускает собранное приложение (npm run start).
 */
const baseURL = process.env.UI_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e/ui",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/ui/global-setup.ts",
  globalTeardown: "./e2e/ui/global-teardown.ts",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "ru-RU", timezoneId: "Europe/Moscow" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1300, height: 900 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true } },
  ],
  webServer: process.env.UI_START ? { command: "npm run start", url: baseURL, timeout: 120_000, reuseExistingServer: false } : undefined,
});
