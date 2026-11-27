import { defineConfig } from "@playwright/test";
import { prBrowserViewports, focusBrowserProject } from "./browser-projects";
import production from "./production.playwright.config";

const smoke = [
  "browser-environment.spec.ts",
  "firebase-isolation.spec.ts",
  "build-options.spec.ts",
  "contextual-learning.spec.ts",
  "manual-help-interaction.spec.ts",
  "escape-close.spec.ts",
  "game-workspace.spec.ts",
  "insights-policy-projection.spec.ts",
  "mission-evidence.spec.ts",
  "tutorial-exit.spec.ts",
  "tutorial-actions.spec.ts",
  "tutorial-map.spec.ts",
  "cloud-saves.spec.ts",
  "menu-keyboard.spec.ts",
  "main-menu.spec.ts",
  "home-entry.spec.ts",
  "home-motion.spec.ts",
  "music.spec.ts",
  "music-startup.spec.ts",
  "pwa-sound.spec.ts",
  "achievements.spec.ts",
  "loading-navigation.spec.ts",
  "facilities-production-chart.spec.ts",
  "production-chart-motion.spec.ts",
  "intertie-order.spec.ts",
  "facility-selection.spec.ts",
  "operations-priorities.spec.ts",
  "offline-launch.spec.ts",
];
const layout = [
  "build-rail.spec.ts",
  "grid-status.spec.ts",
  "project-build.spec.ts",
  "cities-capacity.spec.ts",
  "map-3d.spec.ts",
  "regional-map.spec.ts",
  "chernobyl-recovery.spec.ts",
  "difficulty-unlocks.spec.ts",
  "toggle-borders.spec.ts",
  "chart-touch.spec.ts",
  "insights-expanded-chart.spec.ts",
  "insights-shortfall.spec.ts",
  "build-generator-loading.spec.ts",
  "campaign.spec.ts",
  "sign-in.spec.ts",
  "learning-pages.spec.ts",
  "scenario-pages.spec.ts",
  "ui-chart-build-polish.spec.ts",
  "multiline-text.spec.ts",
  "modal-layout.spec.ts",
  "wildfire-scenario.spec.ts",
  "acquisitions.spec.ts",
  "tutorial-capstone.spec.ts",
  "short-pane-responsive.spec.ts",
];

// Desktop owns the full PR journeys. The phone owns touch interactions and the
// minimum phone owns space-constrained layouts. One invocation shards them together.
export default defineConfig({
  ...production,
  // Ordinary journeys exercise the real WebGL scene with motion reduced.
  // Motion contracts opt in to full animation where they measure it.
  use: { ...production.use, reducedMotion: "reduce" },
  projects: prBrowserViewports.map((project) =>
    project.name === "desktop-chromium"
      ? { ...project, testMatch: [...smoke, ...layout] }
      : focusBrowserProject(project, true),
  ),
});
