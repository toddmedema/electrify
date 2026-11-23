import {
  _electron,
  ElectronApplication,
  expect,
  Page,
  test,
} from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const workspace = path.resolve(__dirname, "..");
const profileRoot = path.join(workspace, ".tmp", "desktop-qa");
const requireHeadedDesktop = require("../scripts/desktop-test-setup.js");
export const { desktopDeadline, closeDesktop } =
  require("../scripts/ci/desktop-process.js") as {
    desktopDeadline: <T>(
      label: string,
      operation: () => Promise<T>,
      timeoutMs?: number,
    ) => Promise<T>;
    closeDesktop: (
      session: Pick<DesktopSession, "app" | "nativeProcess" | "isClosed">,
      options?: { force?: boolean; timeoutMs?: number },
    ) => Promise<void>;
  };

export interface DesktopSession {
  app: ElectronApplication;
  nativeProcess: ReturnType<ElectronApplication["process"]>;
  isClosed: () => boolean;
  page: Page;
  errors: string[];
  externalRequests: string[];
  nativeLog: string[];
}

export async function createDesktopProfile(): Promise<string> {
  await fs.mkdir(profileRoot, { recursive: true });
  return fs.mkdtemp(path.join(profileRoot, "profile-"));
}

export async function removeDesktopProfile(profile: string): Promise<void> {
  const resolved = path.resolve(profile);
  if (!resolved.startsWith(`${profileRoot}${path.sep}`)) {
    throw new Error("Refusing to remove a profile outside the QA directory.");
  }
  await fs.rm(resolved, { recursive: true, force: true });
}

export async function launchDesktop(profile: string): Promise<DesktopSession> {
  // Also protect direct Playwright runs that bypass desktop.playwright.config.ts.
  requireHeadedDesktop({ projects: [test.info().project] });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
    ),
  );
  const executablePath =
    process.env.ELECTRIFY_EXECUTABLE || (require("electron") as string);
  const app = await _electron.launch({
    executablePath,
    args: process.env.ELECTRIFY_EXECUTABLE
      ? [`--electrify-profile=${profile}`]
      : [workspace],
    cwd: workspace,
    env: {
      ...env,
      ELECTRIFY_USER_DATA_DIR: profile,
      ELECTRIFY_OFFLINE: "1",
      ELECTRIFY_TEST: "1",
    },
    timeout: 30_000,
  });
  // Playwright disposes its app proxy after a normal in-game quit. Keep process
  // ownership outside that proxy so teardown also works after the close event.
  const nativeProcess = app.process();
  let closed = false;
  app.once("close", () => {
    closed = true;
  });
  const isClosed = () => closed;
  const nativeLog: string[] = [];
  for (const stream of [nativeProcess.stdout, nativeProcess.stderr])
    stream?.on("data", (data: Buffer) => {
      nativeLog.push(data.toString());
      if (nativeLog.length > 100) nativeLog.shift();
    });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    const externalRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("request", (request) => {
      if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
    });
    // The native startup awaits loadURL. Navigating after only DOMContentLoaded
    // can abort that initial load before the BrowserWindow is ready to show.
    await page.waitForLoadState("load");
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isVisible(),
        ),
      )
      .toBe(true);
    // Renderer readiness precedes macOS's asynchronous native fullscreen entry.
    // Observe the configured mode; never force it, which could hide a startup bug.
    const fullscreen = await page.evaluate(async () => {
      const state = await window.electrifyDesktop!.getState();
      return state.display.fullscreen;
    });
    await app.evaluate(async ({ app, BrowserWindow }, expected) => {
      const nativeRequire = process
        .getBuiltinModule("module")
        .createRequire(`${app.getAppPath()}/package.json`);
      const { waitForFullscreen } = nativeRequire(
        `${app.getAppPath()}/electron/display.cjs`,
      );
      await waitForFullscreen(BrowserWindow.getAllWindows()[0], expected);
    }, fullscreen);
    return {
      app,
      nativeProcess,
      isClosed,
      page,
      errors,
      externalRequests,
      nativeLog,
    };
  } catch (error) {
    // Setup has not transferred ownership to the caller's afterEach yet.
    await closeDesktop({ app, nativeProcess, isClosed }, { force: true });
    throw error;
  }
}

export async function displayState(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return {
      fullscreen: window.isFullScreen(),
      contentSize: window.getContentSize(),
      // Electron exposes this runtime inspection method internally, so it is
      // absent from the public TypeScript declarations.
      webPreferences: (
        window.webContents as unknown as {
          getLastWebPreferences(): Record<string, unknown>;
        }
      ).getLastWebPreferences(),
    };
  });
}
