import { defineConfig } from "@playwright/test";

// Run against the real production renderer and Electron main/preload processes;
// a dev server would hide missing assets and custom-protocol worker failures.
export default defineConfig({
  testDir: ".",
  testMatch: "desktop*.spec.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  projects: [{ name: "electron" }],
  use: { trace: "retain-on-failure" },
});
