import { defineConfig } from "@playwright/test";
import production from "./production.playwright.config";

const smoke = [
  "browser-environment.spec.ts",
  "build-options.spec.ts",
  "contextual-learning.spec.ts",
  "escape-close.spec.ts",
  "game-workspace.spec.ts",
  "tutorial-exit.spec.ts",
  "tutorial-actions.spec.ts",
  "cloud-saves.spec.ts",
  "menu-keyboard.spec.ts",
  "main-menu.spec.ts",
  "music.spec.ts",
  "achievements.spec.ts",
  "loading-navigation.spec.ts",
  "facilities-production-chart.spec.ts",
  "production-chart-motion.spec.ts",
  "intertie-order.spec.ts",
  "operations-priorities.spec.ts",
];
const layout = [
  "learning-pages.spec.ts",
  "ui-chart-build-polish.spec.ts",
  "multiline-text.spec.ts",
  "modal-layout.spec.ts",
  "wildfire-scenario.spec.ts",
];

// Run the PR smoke matrix at 1280/390 px and layout checks at 1280/390/360 px.
// One invocation lets Playwright shard all cases together without starting a dev compiler.
export default defineConfig({
  ...production,
  projects: production
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
});
