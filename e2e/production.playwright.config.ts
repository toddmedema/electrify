import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import base from "./playwright.config";

const port = process.env.E2E_PORT || "3100";
// Local and hosted checks use the same production server and acceptance policy.
// Keep retries for diagnostics, but never report a passing gate after a failed attempt.
export default defineConfig({
  ...base,
  testIgnore: [...(base.testIgnore as string[]), "mods.spec.ts"],
  outputDir: path.resolve(__dirname, "../test-results/browser"),
  forbidOnly: true,
  failOnFlakyTests: true,
  retries: 2,
  workers:
    process.env.GITHUB_ACTIONS === "true"
      ? 2
      : Math.max(2, Math.min(6, Math.floor(os.availableParallelism() / 2))),
  webServer: {
    command: "node scripts/ci/serve.js",
    cwd: path.resolve(__dirname, ".."),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
});
