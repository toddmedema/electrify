import { defineConfig } from "@playwright/test";
import path from "node:path";
import production from "./production.playwright.config";

// Explicit diagnostic workload; ordinary test discovery and the CI smoke matrix do not select it.
export default defineConfig({
  ...production,
  testMatch: "ci-work.bench.ts",
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  projects: production.projects!.filter((project) =>
    ["desktop-chromium", "mobile-390px", "mobile-360px"].includes(
      project.name!,
    ),
  ),
  outputDir: path.resolve(
    __dirname,
    "../test-results/ci-work-bench/screenshots",
  ),
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.resolve(
          __dirname,
          "../test-results/ci-work-bench/results.json",
        ),
      },
    ],
  ],
});
