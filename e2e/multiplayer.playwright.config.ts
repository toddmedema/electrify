import { defineConfig } from "@playwright/test";
import path from "node:path";

const port = process.env.E2E_PORT || "3115";
const outputDir =
  process.env.ELECTRIFY_E2E_OUTPUT_DIR ||
  path.resolve(__dirname, "../test-results/multiplayer");
const productionBuild =
  process.env.MULTIPLAYER_BUILD_DIR ||
  (process.env.GITHUB_ACTIONS === "true" ? "build" : undefined);
const productionRoot = productionBuild
  ? path.resolve(__dirname, "..", productionBuild)
  : undefined;
if (productionRoot) {
  try {
    require("../scripts/verify-edition-bundle").verifyEditionBundle(
      productionRoot,
      "desktop",
    );
  } catch (error) {
    throw new Error(
      `Multiplayer tests need a verified desktop renderer. Run npm run desktop:build first. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
// Desktop-renderer specs that replace the native bridge with an in-memory one: Steam
// multiplayer and mod management (Workshop and local packages). The name is
// historical. The real gameplay, input navigation, host worker and checkpoint protocol still run.
// CI reuses its verified production desktop artifact; local dev remains available by default.
export default defineConfig({
  testDir: ".",
  testMatch: ["multiplayer.spec.ts", "mods.spec.ts"],
  outputDir,
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.join(outputDir, "results.json"),
      },
    ],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: productionRoot ? "node scripts/ci/serve.js" : "npm start",
    cwd: path.resolve(__dirname, ".."),
    url: `http://127.0.0.1:${port}`,
    timeout: 180000,
    reuseExistingServer: false,
    env: {
      BROWSER: "none",
      HOST: "127.0.0.1",
      PORT: port,
      ELECTRIFY_E2E: "1",
      REACT_APP_DESKTOP: "true",
      ...(productionRoot
        ? { E2E_BUILD_DIR: productionRoot, E2E_PORT: port }
        : {}),
    },
  },
});
