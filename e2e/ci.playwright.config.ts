import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import base from "./playwright.config";

const smoke = [
  "build-options.spec.ts",
  "escape-close.spec.ts",
  "game-workspace.spec.ts",
  "tutorial-exit.spec.ts",
  "tutorial-actions.spec.ts",
  "cloud-saves.spec.ts",
  "menu-keyboard.spec.ts",
  "main-menu.spec.ts",
  "music.spec.ts",
  "achievements.spec.ts",
  "facilities-production-chart.spec.ts",
  "intertie-order.spec.ts",
  "operations-priorities.spec.ts",
];
const layout = ["multiline-text.spec.ts", "modal-layout.spec.ts"];
const port = process.env.E2E_PORT || "3100";
// GitHub's runners have few cores, so they keep two workers. Local checks set CI=true too, so
// only GITHUB_ACTIONS identifies a runner; workstations use up to six, leaving half the cores.
const workers = process.env.GITHUB_ACTIONS
  ? 2
  : Math.max(2, Math.min(6, Math.floor(os.availableParallelism() / 2)));

// Run the PR smoke matrix at 1280/390 px and layout checks at 1280/390/360 px.
// One invocation lets Playwright shard all cases together without starting a dev compiler.
export default defineConfig({
  ...base,
  outputDir: path.resolve(__dirname, "../test-results/browser"),
  workers,
  projects: base
    .projects!.filter((project) =>
      ["desktop-chromium", "mobile-390px", "mobile-360px"].includes(
        project.name!,
      ),
    )
    .map((project) => ({
      ...project,
      testMatch:
        project.name === "mobile-360px"
          ? [...layout, "tutorial-actions.spec.ts", "main-menu.spec.ts"]
          : [...smoke, ...layout],
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
