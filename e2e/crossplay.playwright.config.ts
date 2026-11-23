import { defineConfig } from "@playwright/test";
import path from "node:path";

const port = process.env.E2E_PORT || "3189";
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "crossplay.spec.ts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  outputDir: "../test-results/crossplay",
  projects: [
    {
      name: "desktop-chromium",
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile-390px",
      use: {
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "mobile-360px",
      use: {
        hasTouch: true,
        isMobile: true,
        viewport: { width: 360, height: 640 },
        colorScheme: "dark",
      },
    },
  ],
  use: {
    launchOptions:
      require("../scripts/ci/browser-launch").browserLaunchOptions(),
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "node scripts/ci/crossplay-test-server.js",
        cwd: path.resolve(__dirname, ".."),
        url: baseURL,
        env: { E2E_PORT: port },
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
