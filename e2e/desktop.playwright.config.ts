import { defineConfig } from "@playwright/test";
import path from "node:path";

// Run against the real production renderer and Electron main/preload processes;
// a dev server would hide missing assets and custom-protocol worker failures.
export default defineConfig({
  testDir: ".",
  testMatch: "desktop*.spec.ts",
  outputDir: path.resolve(__dirname, "../test-results/desktop"),
  globalSetup: require.resolve("../scripts/desktop-test-setup.js"),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI
    ? [
        ["github"],
        [
          "json",
          {
            outputFile: path.resolve(
              __dirname,
              "../test-results/desktop-results.json",
            ),
          },
        ],
      ]
    : "list",
  projects: [{ name: "electron" }],
  use: {
    trace: {
      mode: "retain-on-failure",
      screenshots: !process.env.CI,
      snapshots: true,
      sources: true,
    },
    screenshot: "only-on-failure",
  },
});
