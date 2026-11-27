import { defineConfig } from "@playwright/test";
import { browserViewports, focusBrowserProject } from "./browser-projects";
import { journeyTrace } from "./journey-trace";

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
    "couch.spec.ts",
    "multiplayer.spec.ts",
    "crossplay.spec.ts",
    "steam-input.spec.ts",
  ],
  timeout: 45000,
  expect: { timeout: 12000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["./expected-error.reporter.ts"],
    [process.env.CI ? "github" : "list"],
  ],
  use: {
    launchOptions:
      require("../scripts/ci/browser-launch").browserLaunchOptions(),
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    trace: journeyTrace,
  },
  projects:
    process.env.ELECTRIFY_E2E_ALL_SPECS === "1"
      ? browserViewports
      : browserViewports.map((project) => focusBrowserProject(project)),
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
