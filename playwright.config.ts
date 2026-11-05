import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:5174/oweme/",
    timezoneId: "Asia/Manila",
    locale: "en-PH",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel:
          process.env.CI || process.platform !== "win32" ? undefined : "chrome",
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command:
      "node ./node_modules/vite/bin/vite.js --configLoader runner --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174/oweme/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { VITE_CACHE_DIR: "node_modules/.vite-e2e" },
  },
});
