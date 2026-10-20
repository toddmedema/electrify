import { defineConfig } from "@playwright/test";

// Not 3000: with reuseExistingServer, a local `npm start` there would be reused without the
// e2e environment below.
const port = process.env.E2E_PORT || "3100";
// Reuse an explicitly hosted production build for real frame measurements. The default
// remains the development server so the normal UI suite still gets its e2e environment.
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testIgnore: [
    "desktop*.spec.ts",
    "multiplayer.spec.ts",
    "steam-input.spec.ts",
  ],
  timeout: 45000,
  expect: { timeout: 12000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile-390px",
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "mobile-360px",
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { width: 360, height: 640 },
      },
    },
    {
      name: "tablet-768px",
      use: {
        browserName: "chromium",
        hasTouch: true,
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "foldable-unfolded",
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { width: 844, height: 690 },
      },
    },
    {
      name: "desktop-1440px",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm start",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
        env: {
          BROWSER: "none",
          HOST: "127.0.0.1",
          PORT: port,
          // Hide only chunk-load failures from the dev runtime-error overlay (see scripts/start.js)
          ELECTRIFY_E2E: "1",
        },
      },
});
