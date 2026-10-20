import { defineConfig } from "@playwright/test";
import path from "node:path";
import base from "./playwright.config";

const port = process.env.E2E_PORT || "3197";
const productionBuild = process.env.STEAM_INPUT_BUILD_DIR;
const productionRoot = productionBuild
  ? path.resolve(__dirname, "..", productionBuild)
  : undefined;
if (productionRoot)
  require("../scripts/verify-edition-bundle").verifyEditionBundle(
    productionRoot,
    "desktop",
  );

// The renderer is unchanged: only the sandboxed native input/save bridge is replaced.
export default defineConfig({
  ...base,
  testMatch: "steam-input.spec.ts",
  testIgnore: [],
  outputDir: "../test-results/steam-input",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  projects: base
    .projects!.filter((project) =>
      ["desktop-chromium", "mobile-390px", "mobile-360px"].includes(
        project.name!,
      ),
    )
    .map((project) => ({
      ...project,
      use: {
        ...project.use,
        colorScheme: project.name!.startsWith("mobile-")
          ? ("dark" as const)
          : ("light" as const),
      },
    })),
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
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
