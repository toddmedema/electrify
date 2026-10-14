import { _electron, ElectronApplication, Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const workspace = path.resolve(__dirname, "..");
const profileRoot = path.join(workspace, ".tmp", "desktop-qa");

export interface DesktopSession {
  app: ElectronApplication;
  page: Page;
  errors: string[];
  externalRequests: string[];
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
  return { app, page, errors, externalRequests };
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
