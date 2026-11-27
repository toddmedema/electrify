import { defineConfig } from "@playwright/test";
import path from "node:path";

const port = process.env.E2E_PORT || "3189";
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;

const build = process.env.CROSSPLAY_BUILD_DIR;

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
    // Continuous screencasts force both 3D canvases through GPU readbacks and
    // delay context teardown. Keep the failure screenshots and structured trace.
    trace: { mode: "retain-on-failure", screenshots: false },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: build ? "node scripts/ci/serve.js" : "npm start",
        cwd: path.resolve(__dirname, ".."),
        url: baseURL,
        env: {
          E2E_PORT: port,
          ...(build
            ? { E2E_BUILD_DIR: build }
            : {
                PORT: port,
                HOST: "127.0.0.1",
                BROWSER: "none",
                ELECTRIFY_E2E: "1",
                REACT_APP_DESKTOP: "true",
              }),
        },
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
