import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Use a system/pre-installed Chromium when present (e.g. cloud sandboxes) instead of downloading.
const chromiumPath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const gpuArgs = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"];

const PORT = Number(process.env.E2E_PORT ?? 3100);
// Next dev only serves its client runtime to allowed origins; localhost is the default one.
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Smoke tests against the zero-infra static mode. Start the app yourself for iteration
 * (`E2E_BASE_URL=http://localhost:3000 pnpm e2e`), or let Playwright boot a dev server.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: {
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
      args: gpuArgs,
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm dev --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { COMMERCE_MODE: "demo" },
      },
});
