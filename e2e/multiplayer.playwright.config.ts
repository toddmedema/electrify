import { defineConfig } from "@playwright/test";
import path from "node:path";

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
// Headless desktop renderer with an in-memory replacement for the native Steam bridge.
// The real host worker, gameplay, command routing and checkpoint protocol still run.
// CI reuses its verified production desktop artifact; local dev remains available by default.
export default defineConfig({
  testDir: ".",
  testMatch: "multiplayer.spec.ts",
  outputDir: "../test-results/multiplayer",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3115",
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: productionRoot ? "node scripts/ci/serve.js" : "npm start",
    cwd: path.resolve(__dirname, ".."),
    url: "http://127.0.0.1:3115",
    timeout: 180000,
    reuseExistingServer: false,
    env: {
      BROWSER: "none",
      HOST: "127.0.0.1",
      PORT: "3115",
      ELECTRIFY_E2E: "1",
      REACT_APP_DESKTOP: "true",
      ...(productionRoot
        ? { E2E_BUILD_DIR: productionRoot, E2E_PORT: "3115" }
        : {}),
    },
  },
});
