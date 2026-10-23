import { defineConfig } from "@playwright/test";
import path from "node:path";
import base from "./playwright.config";

const port = process.env.E2E_PORT || "3100";
const outputDir =
  process.env.ELECTRIFY_E2E_OUTPUT_DIR ||
  path.resolve(__dirname, "../test-results/browser");
// Local and hosted checks use the same production server and acceptance policy.
// Keep retries for diagnostics, but never report a passing gate after a failed attempt.
export default defineConfig({
  ...base,
  testIgnore: [...(base.testIgnore as string[]), "mods.spec.ts"],
  outputDir,
  reporter: [
    [process.env.GITHUB_ACTIONS === "true" ? "github" : "list"],
    [
      "json",
      {
        outputFile: path.join(outputDir, "results.json"),
      },
    ],
  ],
  forbidOnly: true,
  failOnFlakyTests: true,
  retries: 2,
  // Match hosted concurrency so local evidence does not depend on spare machine cores.
  workers: 2,
  webServer: {
    command: "node scripts/ci/serve.js",
    cwd: path.resolve(__dirname, ".."),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
});
