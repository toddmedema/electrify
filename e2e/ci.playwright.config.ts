import { defineConfig } from "@playwright/test";
import path from "node:path";
import base from "./playwright.config";

const smoke = [
  "build-options.spec.ts",
  "escape-close.spec.ts",
  "game-workspace.spec.ts",
  "tutorial-exit.spec.ts",
  "cloud-saves.spec.ts",
  "menu-keyboard.spec.ts",
  "music.spec.ts",
  "achievements.spec.ts",
];
const layout = ["multiline-text.spec.ts", "modal-layout.spec.ts"];
const port = process.env.E2E_PORT || "3100";

// Run the PR smoke matrix at 1280/390 px and layout checks at 1280/390/360 px.
// One invocation lets Playwright shard all cases together without starting a dev compiler.
export default defineConfig({
  ...base,
  outputDir: path.resolve(__dirname, "../test-results/browser"),
  workers: 2,
  projects: base
    .projects!.filter((project) =>
      ["desktop-chromium", "mobile-390px", "mobile-360px"].includes(
        project.name!,
      ),
    )
    .map((project) => ({
      ...project,
      testMatch:
        project.name === "mobile-360px" ? layout : [...smoke, ...layout],
    })),
  webServer: {
    command: "node scripts/ci/serve.js",
    cwd: path.resolve(__dirname, ".."),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
});
