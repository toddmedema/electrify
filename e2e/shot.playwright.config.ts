import { defineConfig } from "@playwright/test";
import path from "node:path";
import base from "./playwright.config";
import { readShotRequest } from "./shot-request";
import { MARKETING_SCENES } from "./marketing-scenes";

// Driven by `npm run shot` (scripts/dev/shot.js). Not part of any suite: the runner file is
// not a *.spec.ts, so ordinary discovery never selects it. One project per viewport and theme.
const request = readShotRequest();

/** Reuse the e2e project of the same width (phone emulation, touch) when one exists. */
function viewportOptions({
  width,
  height,
}: {
  width: number;
  height?: number;
}) {
  const known = base.projects?.find(
    (project) => project.use?.viewport?.width === width,
  )?.use;
  const use = known ?? {
    browserName: "chromium" as const,
    viewport: { width, height: width < 768 ? 844 : 800 },
    ...(width < 768 ? { hasTouch: true, isMobile: true } : {}),
  };
  return height ? { ...use, viewport: { width, height } } : use;
}

export default defineConfig({
  testDir: ".",
  testMatch: request.marketing ? "marketing.run.ts" : "shot.run.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 3,
  retries: 0,
  forbidOnly: true,
  reporter: [[path.resolve(__dirname, "shot.reporter.ts")]],
  outputDir: path.resolve(__dirname, "../.tmp/shot-run"),
  use: {
    launchOptions: base.use?.launchOptions,
    baseURL: request.baseURL,
    headless: true,
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  projects: request.marketing
    ? MARKETING_SCENES.map((scene) => ({
        name: scene.name,
        use: {
          browserName: "chromium" as const,
          viewport: scene.viewport,
          colorScheme: scene.theme,
          deviceScaleFactor: scene.name === "gameplay-preview" ? 1 : 4 / 3,
        },
      }))
    : request.viewports.flatMap((viewport) =>
        request.themes.map((theme) => ({
          name: `${viewport.label}-${theme}`,
          use: {
            ...viewportOptions(viewport),
            colorScheme: theme,
            deviceScaleFactor: 1,
          },
        })),
      ),
});
