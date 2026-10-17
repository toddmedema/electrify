import { expect, test, ElectronApplication, Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createDesktopProfile,
  DesktopSession,
  displayState,
  launchDesktop,
  removeDesktopProfile,
} from "./desktop-fixture";
import { readSavedGame, readSaveRecords } from "./save-fixture";
import type { DesktopState } from "../src/Desktop";
import { SAVE_DATABASE_NAME } from "../src/SaveRepository";
import { decodeSave } from "../src/SaveEncoding";
import type { SaveGameType } from "../src/Types";
import { openPane } from "./layout";
import type { ProjectionTransport } from "../src/components/base/ProjectionTransport";

interface DesktopWorkerAudit {
  requested: number;
  completed: number;
  errors: number;
  workers: string[];
  requests: { requestId: number; monthsElapsed: number; rate: number }[];
  messages: { requestId?: number; keys: string[] }[];
  replies: {
    requestId: number;
    numericBytes: number;
    cashMonths: number;
    forecastTicks: number;
  }[];
}

const workspace = path.resolve(__dirname, "..");

async function walk(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const children = await Promise.all(
    entries.map((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(file) : [file];
    }),
  );
  return children.flat();
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
}

async function exitFullscreen(app: ElectronApplication) {
  await app.evaluate(async ({ BrowserWindow, app: nativeApp }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const nativeRequire = process
      .getBuiltinModule("module")
      .createRequire(`${nativeApp.getAppPath()}/package.json`);
    const { setFullscreen } = nativeRequire(
      `${nativeApp.getAppPath()}/electron/display.cjs`,
    );
    await setFullscreen(window, false);
  });
  await expect
    .poll(async () => (await displayState(app)).fullscreen)
    .toBe(false);
}

async function focusNativeWindow(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].focus(),
  );
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isFocused(),
      ),
    )
    .toBe(true);
}

async function nativeShortcut(
  app: ElectronApplication,
  key: string,
  alt = false,
) {
  await focusNativeWindow(app);
  await app.evaluate(
    ({ BrowserWindow }, { key, alt }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const modifiers: Array<"alt"> = alt ? ["alt"] : [];
      contents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
      contents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
    },
    { key, alt },
  );
}

let profile: string;
let desktop: DesktopSession;

async function expectContentSize(app: ElectronApplication, expected: number[]) {
  // Chromium's device-independent bounds round by one pixel with fractional DPI.
  let actual: number[] = [];
  try {
    await expect
      .poll(async () => {
        actual = (await displayState(app)).contentSize;
        return Math.max(
          ...actual.map((size, index) => Math.abs(size - expected[index])),
        );
      })
      .toBeLessThanOrEqual(1);
  } catch (cause) {
    const diagnostic = await app.evaluate(({ BrowserWindow, screen }) => {
      const game = BrowserWindow.getAllWindows()[0];
      const display = screen.getDisplayMatching(game.getBounds());
      return {
        bounds: game.getBounds(),
        content: game.getContentBounds(),
        display: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
      };
    });
    throw new Error(
      `Expected content ${expected.join("×")}, received ${actual.join("×")}; ${JSON.stringify(diagnostic)}`,
      { cause },
    );
  }
}

test.beforeEach(async () => {
  profile = await createDesktopProfile();
  desktop = await launchDesktop(profile);
});

test.afterEach(async ({}, testInfo) => {
  if (desktop) {
    if (
      testInfo.status !== testInfo.expectedStatus &&
      !desktop.page.isClosed()
    ) {
      await testInfo
        .attach("desktop-runtime-diagnostics.json", {
          body: JSON.stringify({
            display: await displayState(desktop.app),
            renderer: await desktop.page.evaluate(() => ({
              visible: document.visibilityState,
              focused: document.hasFocus(),
              worker: (window as unknown as { desktopWorkerAudit?: unknown })
                .desktopWorkerAudit,
              appbar: document.querySelector("#appbar")?.textContent,
            })),
            errors: desktop.errors,
            externalRequests: desktop.externalRequests,
          }),
          contentType: "application/json",
        })
        .catch(() => undefined);
      await testInfo
        .attach("electron-failure.png", {
          body: await desktop.page.screenshot({ timeout: 5000 }),
          contentType: "image/png",
        })
        .catch(() => undefined);
      // An intentionally failed save must not leave a native quit warning or
      // locked temporary Chromium profile behind after a test assertion fails.
      await desktop.app
        .evaluate(({ app }) => app.exit(0))
        .catch(() => undefined);
    }
    await desktop.app.close().catch(() => undefined);
  }
  if (profile) await removeDesktopProfile(profile);
});

test("a fresh offline install launches fullscreen with every bundled file and a sandboxed renderer", async ({}, testInfo) => {
  const { page, app } = desktop;
  await expect(
    page.getByRole("heading", { name: "Electrify", exact: true }),
  ).toBeAttached();
  await expect(
    page.getByRole("button", { name: "Start playing", exact: true }),
  ).toBeVisible();
  expect(page.url()).toBe("electrify://app/index.html");
  expect((await displayState(app)).fullscreen).toBe(true);
  expect((await displayState(app)).webPreferences).toMatchObject({
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  });
  expect(
    await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
      secure: isSecureContext,
    })),
  ).toEqual({ require: "undefined", process: "undefined", secure: true });
  // Load the actual addon before Koffi loads its DLL, matching Steam startup.
  // Offline gameplay must not hide missing native dependencies or an ABI error.
  expect(
    await app.evaluate(({ app }) => {
      const nativeRequire = process
        .getBuiltinModule("module")
        .createRequire(`${app.getAppPath()}/package.json`);
      const bridge = nativeRequire(
        `${app.getAppPath()}/electron/steam-native.cjs`,
      );
      const binding = nativeRequire(bridge.nativeBindingPath());
      return [
        binding.init,
        binding.localplayer.getSteamId,
        binding.cloud.readFile,
        binding.cloud.writeFile,
        binding.overlay.activateDialog,
      ].map((method) => typeof method);
    }),
  ).toEqual(Array(5).fill("function"));
  // Resolve every real Steam export through the shipping bridge without API init.
  const nativeExports = await app.evaluate(({ app }) => {
    const nativeRequire = process
      .getBuiltinModule("module")
      .createRequire(`${app.getAppPath()}/package.json`);
    return Object.keys(
      nativeRequire(
        `${app.getAppPath()}/electron/steam-native.cjs`,
      ).loadFunctions(),
    ).sort();
  });
  expect(nativeExports).toEqual(
    expect.arrayContaining([
      "callResult",
      "download",
      "entry",
      "find",
      "freeCallback",
      "friends",
      "nextCallback",
      "online",
      "persona",
      "pipe",
      "requestPersona",
      "runFrame",
      "shutdown",
      "stats",
      "upload",
      "user",
      "utils",
    ]),
  );

  // Compare bytes fetched through the shipping protocol with the production
  // build. This catches a missing city, font, audio track, icon, or worker chunk
  // even when a short game happens not to use it.
  const build = path.join(workspace, "build");
  const files = await walk(build);
  expect(files.length).toBeGreaterThan(200);
  const assets = await Promise.all(
    files.map(async (file) => {
      const bytes = await fs.readFile(file);
      expect(bytes.subarray(0, 64).toString("utf8"), file).not.toMatch(
        /^version https:\/\/git-lfs.github.com\/spec\/v1/,
      );
      return {
        name: path.relative(build, file).split(path.sep).join("/"),
        size: bytes.byteLength,
        hash: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
  const failures: string[] = [];
  for (let index = 0; index < assets.length; index += 12) {
    const results = await page.evaluate(
      async (batch) =>
        Promise.all(
          batch.map(async (asset) => {
            const url = `electrify://app/${asset.name.split("/").map(encodeURIComponent).join("/")}`;
            try {
              const response = await fetch(url);
              const bytes = await response.arrayBuffer();
              const hash = Array.from(
                new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
              )
                .map((byte) => byte.toString(16).padStart(2, "0"))
                .join("");
              return response.ok &&
                bytes.byteLength === asset.size &&
                hash === asset.hash
                ? null
                : `${asset.name}: status=${response.status}, bytes=${bytes.byteLength}, expected=${asset.size}, hashMatches=${hash === asset.hash}`;
            } catch (error) {
              return `${asset.name}: ${String(error)}`;
            }
          }),
        ),
      assets.slice(index, index + 12),
    );
    failures.push(
      ...results.filter((result): result is string => result !== null),
    );
  }
  expect(failures).toEqual([]);
  const audio = await page.evaluate(async () => {
    const context = new AudioContext();
    try {
      const response = await fetch("audio/menu/quiet-current.wav");
      const decoded = await context.decodeAudioData(
        await response.arrayBuffer(),
      );
      return { duration: decoded.duration, channels: decoded.numberOfChannels };
    } finally {
      await context.close();
    }
  });
  expect(audio.duration).toBeGreaterThan(1);
  expect(audio.channels).toBeGreaterThan(0);
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
  await testInfo.attach("offline-bundle-audit.json", {
    body: JSON.stringify(
      {
        files: assets.length,
        bytes: assets.reduce((total, asset) => total + asset.size, 0),
        audio,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });

  // These requests must be refused, including another custom-protocol host and
  // attempts to read files outside the bundle. No real network access is needed.
  const denied = await page.evaluate(async () =>
    Promise.all(
      [
        "https://example.com/",
        "http://127.0.0.1:65534/",
        "electrify://other/index.html",
        "electrify://app/../../package.json",
        "file:///C:/Windows/win.ini",
      ].map(async (url) => {
        try {
          return !(await fetch(url)).ok;
        } catch {
          return true;
        }
      }),
    ),
  );
  expect(denied).toEqual([true, true, true, true, true]);
});

test("the first offline walkthrough leads to a mission that saves, resumes after relaunch, and quits from the game", async () => {
  let page = desktop.page;
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await page.getByRole("button", { name: "Inspect Coal", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Tap 1× to start time")).toBeVisible();
  await page.getByRole("button", { name: "normal speed", exact: true }).click();
  await expect(
    page.getByText("Reach midnight without a blackout"),
  ).toBeVisible();
  await page.getByRole("button", { name: "pause", exact: true }).click();
  // Walkthroughs deliberately do not create resumable games. A normal mission
  // exercises persistence after the first-launch guidance has been checked.
  expect(await readSaveRecords(page)).toHaveLength(0);
  await page.goto("electrify://app/index.html?scenario=101");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect.poll(async () => (await readSaveRecords(page)).length).toBe(1);
  const before = await readSavedGame(page);
  expect(before).toBeDefined();
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
  await desktop.app.close();
  desktop = await launchDesktop(profile);
  page = desktop.page;
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#appbar:visible")).toBeVisible();
  const after = await readSavedGame(page);
  expect(after?.date).toEqual(before?.date);
  expect(after?.facilities).toEqual(before?.facilities);
  expect((await readSaveRecords(page)).length).toBe(1);
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "menu", exact: true }).click();
  const quit = page.getByRole("menuitem", { name: "Quit", exact: true });
  await expect(quit).toBeVisible();
  const closed = desktop.app.waitForEvent("close");
  await quit.click();
  await closed;
});

test("a forced process exit recovers its saved mission immediately on relaunch", async () => {
  let page = desktop.page;
  await page.goto("electrify://app/index.html?scenario=101");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect.poll(async () => (await readSaveRecords(page)).length).toBe(1);
  const before = await readSavedGame(page);
  const leases = await page.evaluate(
    (name) =>
      new Promise<Array<{ expiresAt: number }>>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("sessions", "readonly");
          const rows = tx.objectStore("sessions").getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(rows.result);
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
    SAVE_DATABASE_NAME,
  );
  expect(leases).toHaveLength(1);
  expect(leases[0].expiresAt).toBeGreaterThan(Date.now());
  const closed = desktop.app.waitForEvent("close");
  // app.exit deliberately bypasses the normal checkpoint/release handshake.
  await desktop.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await closed;
  desktop = await launchDesktop(profile);
  page = desktop.page;
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#appbar:visible")).toBeVisible();
  const after = await readSavedGame(page);
  expect(after?.date).toEqual(before?.date);
  expect(after?.facilities).toEqual(before?.facilities);
  expect(await readSaveRecords(page)).toHaveLength(1);
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
});

test("a failed desktop checkpoint keeps the game open and recovers before quitting", async ({}, testInfo) => {
  const { page, app } = desktop;
  await page.goto("electrify://app/index.html?scenario=101");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect.poll(async () => (await readSaveRecords(page)).length).toBe(1);
  const before = await readSavedGame(page);
  // Inject a disk-backup failure at the actual preload/main IPC boundary. The
  // native warning is intercepted so this unattended check can choose Return.
  await app.evaluate(({ ipcMain, dialog }) => {
    const globals = globalThis as unknown as {
      desktopQuitWarnings: string[];
      desktopOriginalMessageBox: typeof dialog.showMessageBox;
    };
    globals.desktopQuitWarnings = [];
    globals.desktopOriginalMessageBox = dialog.showMessageBox;
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args[args.length - 1] as { title: string };
      globals.desktopQuitWarnings.push(options.title);
      return { response: 1, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
    ipcMain.removeHandler("desktop:write-saves");
    ipcMain.handle("desktop:write-saves", () => {
      throw new Error("QA injected desktop disk write failure");
    });
  });
  await page.getByRole("button", { name: "menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Quit", exact: true }).click();
  // Only the native warning asks the player what to do; the game shows the failed save inline.
  await expect(
    page.getByRole("button", { name: "Save failed · Manage saves" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as unknown as { desktopQuitWarnings: string[] })
            .desktopQuitWarnings,
      ),
    )
    .toEqual(["Save before quitting"]);
  const retained = await readSaveRecords(page);
  expect(retained).toHaveLength(1);
  expect((decodeSave(retained[0].save) as SaveGameType).game.date).toEqual(
    before?.date,
  );
  expect(
    await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
  ).toBe(1);
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await app.evaluate(({ app, ipcMain, dialog }) => {
    const nativeRequire = process
      .getBuiltinModule("module")
      .createRequire(`${app.getAppPath()}/package.json`);
    const { DesktopSaveStore } = nativeRequire(
      `${app.getAppPath()}/electron/storage.cjs`,
    );
    const saves = new DesktopSaveStore(app.getPath("userData"), {
      state: () => ({}),
      cloudState: () => "disabled",
    });
    ipcMain.removeHandler("desktop:write-saves");
    ipcMain.handle("desktop:write-saves", (_event, library, sync) =>
      saves.write(library, sync),
    );
    dialog.showMessageBox = (
      globalThis as unknown as {
        desktopOriginalMessageBox: typeof dialog.showMessageBox;
      }
    ).desktopOriginalMessageBox;
  });
  const closed = app.waitForEvent("close");
  await page.getByRole("button", { name: "menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Quit", exact: true }).click();
  await closed;
  await testInfo.attach("injected-save-failure.json", {
    body: JSON.stringify({
      injected: "desktop:write-saves failure",
      observed:
        "game remained open, checkpoint retained, normal retry quit succeeded",
    }),
    contentType: "application/json",
  });
});

test("display settings, native shortcuts, and light/dark layouts remain usable at compact resolution", async () => {
  const { app, page } = desktop;
  await openSettings(page);
  const fullscreen = page.getByRole("switch", {
    name: "Fullscreen",
    exact: true,
  });
  await expect(fullscreen).toBeChecked();
  await fullscreen.uncheck();
  await expect
    .poll(async () => (await displayState(app)).fullscreen)
    .toBe(false);
  const resolution = page.getByRole("combobox", {
    name: "Resolution",
    exact: true,
  });
  await expect(resolution).toBeEnabled();
  const options = await resolution
    .locator("option")
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLOptionElement).value),
    );
  const standard = options.includes("1280x720") ? "1280x720" : options[0];
  const standardSize = standard.split("x").map(Number);
  await resolution.selectOption(standard);
  await expectContentSize(app, standardSize);
  await nativeShortcut(app, "F11");
  await expect
    .poll(async () => (await displayState(app)).fullscreen)
    .toBe(true);
  await expect(fullscreen).toBeChecked();
  await nativeShortcut(app, "Enter", true);
  await expect
    .poll(async () => (await displayState(app)).fullscreen)
    .toBe(false);
  await expect(fullscreen).not.toBeChecked();
  await expectContentSize(app, standardSize);
  await expect(resolution).toHaveValue(standard);
  for (const theme of ["Light", "Dark"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    expect(
      await page
        .locator(".scrollable:visible")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    await resolution.scrollIntoViewIfNeeded();
    await expect(resolution).toHaveValue(standard);
    await expectContentSize(app, standardSize);
    for (const control of [
      fullscreen.locator(
        "xpath=ancestor::*[contains(@class, 'MuiSwitch-root')][1]",
      ),
      resolution,
    ]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.height).toBeGreaterThanOrEqual(40);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
        standardSize[0] + 1,
      );
    }
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.REVIEW_SCREENSHOT_DIR, { recursive: true });
      await page
        .getByRole("heading", { name: "Settings", exact: true })
        .click();
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `desktop-settings-${theme.toLowerCase()}.png`,
        ),
        animations: "disabled",
      });
    }
  }
  await resolution.selectOption("800x600");
  await expectContentSize(app, [800, 600]);
  await expect(resolution).toHaveValue("800x600");
  expect(
    await page
      .locator(".scrollable:visible")
      .evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await resolution.scrollIntoViewIfNeeded();
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        "desktop-settings-800x600-dark.png",
      ),
      animations: "disabled",
    });
  }
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
  const closed = desktop.app.waitForEvent("close");
  await page.getByRole("button", { name: "Quit", exact: true }).click();
  await closed;
  desktop = await launchDesktop(profile);
  expect((await displayState(desktop.app)).fullscreen).toBe(false);
  await expectContentSize(desktop.app, [800, 600]);
  await openSettings(desktop.page);
  await expect(
    desktop.page.getByRole("combobox", { name: "Resolution", exact: true }),
  ).toHaveValue("800x600");
});

test("production projection workers finish offline and native focus pauses and resumes play", async ({}, testInfo) => {
  const { page } = desktop;
  await exitFullscreen(desktop.app);
  await desktop.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1008, 680),
  );
  await page.addInitScript(() => {
    const state: DesktopWorkerAudit = {
      requested: 0,
      completed: 0,
      errors: 0,
      workers: [],
      requests: [],
      messages: [],
      replies: [],
    };
    Object.assign(window, { desktopWorkerAudit: state });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        state.workers.push(new URL(String(url), document.baseURI).href);
        this.addEventListener(
          "message",
          (
            event: MessageEvent<{
              requestId: number;
              transport?: ProjectionTransport;
              error?: boolean;
            }>,
          ) => {
            const data = event.data;
            state.messages.push({
              requestId: data?.requestId,
              keys: data && typeof data === "object" ? Object.keys(data) : [],
            });
            if (data?.transport) {
              state.completed++;
              state.replies.push({
                requestId: data.requestId,
                numericBytes: data.transport.ticks.numbers.values.byteLength,
                cashMonths: data.transport.cashMonths,
                forecastTicks: data.transport.ticks.numbers.count,
              });
            } else if (data?.error) state.errors++;
          },
        );
        this.addEventListener("error", () => state.errors++);
        this.addEventListener("messageerror", () => state.errors++);
      }
      postMessage(message: unknown) {
        if (
          message &&
          typeof message === "object" &&
          "game" in message &&
          "now" in message &&
          "requestId" in message &&
          typeof message.requestId === "number"
        ) {
          state.requested++;
          const request = message as {
            requestId: number;
            game: { date: { monthsElapsed: number }; dollarsPerkWh: number };
          };
          state.requests.push({
            requestId: request.requestId,
            monthsElapsed: request.game.date.monthsElapsed,
            rate: request.game.dollarsPerkWh,
          });
        }
        super.postMessage(message);
      }
    };
  });
  await page.goto("electrify://app/index.html?scenario=103");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await focusNativeWindow(desktop.app);
  await page
    .locator("#appbar:visible")
    .first()
    .getByRole("button", { name: "fast speed", exact: true })
    .click();
  // Exercise native focus notifications through main and preload, including
  // restoring the prior speed rather than restarting an intentionally paused run.
  const focusWindows = await desktop.app.evaluate(async ({ BrowserWindow }) => {
    const game = BrowserWindow.getAllWindows()[0];
    const probe = new BrowserWindow({
      width: 160,
      height: 120,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    await probe.loadURL("data:text/html,<title>Desktop QA focus probe</title>");
    probe.show();
    probe.focus();
    return { game: game.id, probe: probe.id };
  });
  try {
    await expect
      .poll(() =>
        desktop.app.evaluate(({ BrowserWindow }, ids) => {
          return (
            !BrowserWindow.fromId(ids.game)!.isFocused() &&
            BrowserWindow.fromId(ids.probe)!.isFocused()
          );
        }, focusWindows),
      )
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "pause", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    await desktop.app.evaluate(({ BrowserWindow }, ids) => {
      BrowserWindow.fromId(ids.probe)?.destroy();
      BrowserWindow.fromId(ids.game)?.focus();
    }, focusWindows);
  }
  await expect(
    page.getByRole("button", { name: "fast speed", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const workerState = () =>
    page.evaluate(
      () =>
        (window as unknown as { desktopWorkerAudit: DesktopWorkerAudit })
          .desktopWorkerAudit,
    );
  // Investor pricing computes customer changes locally. Make a rate decision in Programs,
  // then open Insights to request its forecast, just as a player does on a compact screen.
  // FAST play or the HUD alone need not request a long-range projection.
  const programs = page.getByRole("region", { name: "Programs", exact: true });
  const insights = page.getByRole("region", { name: "Insights", exact: true });
  const rate = programs.getByRole("slider", {
    name: "The rate you charge for electricity generation",
  });
  // Both decisions use new rates, including when the preceding transport is
  // still being decoded across frames and the initial rate remains cached.
  for (const key of ["ArrowRight", "ArrowRight"]) {
    await openPane(
      programs,
      page.getByRole("button", { name: "Programs", exact: true }),
    );
    const audit = await workerState();
    const before = await rate.getAttribute("aria-valuenow");
    await rate.press(key);
    await expect(rate).not.toHaveAttribute("aria-valuenow", before!);
    const selectedRate = Number(await rate.getAttribute("aria-valuenow"));
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    await expect
      .poll(async () =>
        (await workerState()).requests
          .slice(audit.requests.length)
          .some((request) => Math.abs(request.rate - selectedRate) < 1e-10),
      )
      .toBe(true);
    const request = (await workerState()).requests
      .slice(audit.requests.length)
      .find((request) => Math.abs(request.rate - selectedRate) < 1e-10)!;
    await expect
      .poll(
        async () =>
          (await workerState()).replies.some(
            (reply) => reply.requestId === request.requestId,
          ),
        { timeout: 90_000 },
      )
      .toBe(true);
  }
  const audit = await workerState();
  expect(audit.completed).toBeGreaterThanOrEqual(2);
  expect(new Set(audit.replies.map((reply) => reply.requestId)).size).toBe(
    audit.replies.length,
  );
  for (const reply of audit.replies) {
    expect(reply.numericBytes).toBeGreaterThan(0);
    expect(reply.cashMonths).toBeGreaterThan(0);
    expect(reply.forecastTicks).toBeGreaterThan(0);
  }
  expect(audit.workers.every((url) => url.startsWith("electrify://app/"))).toBe(
    true,
  );
  expect((await workerState()).requested).toBeGreaterThanOrEqual(2);
  expect((await workerState()).errors).toBe(0);
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
  const auditPath = testInfo.outputPath("projection-worker-audit.json");
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.writeFile(auditPath, JSON.stringify(audit, null, 2));
  await testInfo.attach("projection-worker-audit.json", {
    path: auditPath,
    contentType: "application/json",
  });
});

test("mocked Steam IPC shows friends scores and the Steam profile without a web account", async ({}, testInfo) => {
  const { app, page } = desktop;
  const steamState: DesktopState["steam"] = {
    available: true,
    online: true,
    cloudEnabled: false,
    steamId: "76561198000000001",
    displayName: "QA Player",
  };
  // Only this case substitutes native API responses. It verifies the complete
  // renderer -> isolated preload -> main IPC -> score table path, and never
  // contacts Steam or implies a successful live Steamworks integration.
  await app.evaluate(({ app: nativeApp, ipcMain }, steamState) => {
    const nativeRequire = process
      .getBuiltinModule("module")
      .createRequire(`${nativeApp.getAppPath()}/package.json`);
    const { SteamService } = nativeRequire(
      `${nativeApp.getAppPath()}/electron/steam.cjs`,
    );
    // Mock the shared source so the real state getter and native display/Steam
    // broadcasts agree, including delayed startup fullscreen notifications.
    SteamService.prototype.state = () => steamState;
    ipcMain.removeHandler("desktop:leaderboard");
    const requests: {
      scope: string;
      scenarioId: number;
      difficulty?: string;
    }[] = [];
    Object.assign(globalThis, { desktopMockSteamRequests: requests });
    ipcMain.handle("desktop:leaderboard", (_event, selection) => {
      requests.push(selection);
      const friend = selection.scope === "friends";
      const player = selection.scope === "player";
      return [
        {
          steamId: player
            ? "76561198000000001"
            : friend
              ? "76561198000000002"
              : "76561198000000003",
          displayName: player
            ? "QA Player"
            : friend
              ? "QA Friend"
              : "QA Global",
          rank: 1,
          score: player ? 601 : friend ? 725 : 910,
          scenarioId: selection.scenarioId,
          difficulty: selection.difficulty || "Intern",
        },
      ];
    });
  }, steamState);
  await page.goto("electrify://app/index.html?scenario=101");
  const scores = page.locator("#HighScores");
  await expect(scores).toContainText("QA Global");
  await expect(scores).toContainText("Your best");
  // A display confirmation also broadcasts Steam state. Keep the identity and
  // personal score consistent when a native event arrives after initial login.
  const publishedState = await page.evaluate(async () => {
    const bridge = window.electrifyDesktop!;
    const changed = new Promise<DesktopState>((resolve) => {
      const unsubscribe = bridge.onStateChanged((next) => {
        unsubscribe();
        resolve(next);
      });
    });
    await bridge.setDisplay((await bridge.getState()).display);
    return changed;
  });
  await expect(scores).toContainText("Your best");
  expect(publishedState.steam).toEqual(steamState);
  await page.getByRole("button", { name: "Friends", exact: true }).click();
  await expect(scores).toContainText("QA Friend");
  await expect(scores).not.toContainText("QA Global");
  await expect(
    page.getByRole("button", { name: "Friends", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "View all scores", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Leaderboard — All levels",
      exact: true,
    }),
  ).toBeVisible();
  await expect(scores).toContainText("QA Friend");
  await expect(
    page.getByRole("button", { name: "Sign in with Google", exact: true }),
  ).toHaveCount(0);
  await page.goto("electrify://app/index.html");
  await openSettings(page);
  await expect(page.getByText("QA Player", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Steam friends", exact: true }),
  ).toBeEnabled();
  const requests = await app.evaluate(
    () =>
      (
        globalThis as unknown as {
          desktopMockSteamRequests: { scope: string; difficulty?: string }[];
        }
      ).desktopMockSteamRequests,
  );
  expect(requests.some((request) => request.scope === "friends")).toBe(true);
  expect(
    requests.some(
      (request) =>
        request.scope === "friends" && request.difficulty === undefined,
    ),
  ).toBe(true);
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
  await testInfo.attach("mocked-steam-ui.json", {
    body: JSON.stringify(
      {
        disclaimer:
          "Mocked IPC responses; no live Steam credentials, API access, or certification.",
        requests,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});
