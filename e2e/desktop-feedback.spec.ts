import { Browser, chromium, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createDesktopProfile,
  closeDesktop,
  desktopDeadline,
  DesktopSession,
  launchDesktop,
  removeDesktopProfile,
} from "./desktop-fixture";
import { restoreFocusBeforeClosingProbe } from "./desktop-focus";
import { exitSettingsWithBodyArrow } from "./menu-keyboard";
import {
  auditFeedbackAudio,
  feedbackAudio,
  settleInput,
} from "./desktop-feedback-audit";
import { readSavedGame, readSaveRecords } from "./save-fixture";

interface MockControllerAudit {
  connected: boolean;
  reject: boolean;
  effects: Array<{
    type: string;
    duration: number;
    strongMagnitude: number;
    weakMagnitude: number;
    at: number;
    wallAt: number;
  }>;
  resets: number;
  events: Array<{
    kind: string;
    at: number;
    wallAt: number;
    focused: boolean;
    visibility: string;
    nativeFocused: boolean | null;
    reducedMotion: boolean;
    connected: boolean;
  }>;
}

declare global {
  interface Window {
    feedbackControllerAudit: MockControllerAudit;
  }
}

let profile: string;
let desktop: DesktopSession;
let recoveredBrowser: Browser | undefined;

async function focusGame() {
  await desktop.app.evaluate(({ app, BrowserWindow }) => {
    app.focus();
    BrowserWindow.getAllWindows()[0].focus();
  });
  await expect
    .poll(() => desktop.page.evaluate(() => document.hasFocus()))
    .toBe(true);
}

const menuSources = async () =>
  (await feedbackAudio(desktop.page)).starts.filter((source) =>
    // The background soundtrack shares this directory, but is not an effects cue.
    /\/audio\/menu\/(?:select|confirm|back)\.wav$/.test(source.url),
  );

async function captureMenu() {
  const folder = process.env.REVIEW_SCREENSHOT_DIR;
  if (!folder) return;
  const { page } = desktop;
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "Quit", exact: true }),
  ).toBeVisible();
  const clip = await page.evaluate(async () => {
    await document.fonts.ready;
    const logo = document.querySelector(".homeLogo")!.getBoundingClientRect();
    const menu = document
      .querySelector("#centeredMenu")!
      .getBoundingClientRect();
    const x = Math.max(0, Math.floor(Math.min(logo.left, menu.left) - 32));
    const y = Math.max(0, Math.floor(logo.top - 40));
    return {
      x,
      y,
      width: Math.min(
        innerWidth - x,
        Math.ceil(Math.max(logo.right, menu.right) - x + 32),
      ),
      height: Math.min(innerHeight - y, Math.ceil(menu.bottom - y + 24)),
    };
  });
  await fs.mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(folder, "desktop-feedback-menu-light.png"),
    clip,
    animations: "disabled",
  });
}

async function captureSettings() {
  const folder = process.env.REVIEW_SCREENSHOT_DIR;
  if (!folder) return;
  const { page } = desktop;
  const appearance = page.getByRole("group", {
    name: "Appearance",
    exact: true,
  });
  const dark = appearance.getByRole("button", { name: "Dark", exact: true });
  const light = appearance.getByRole("button", { name: "Light", exact: true });
  await dark.click();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await light.focus();
  await expect(light).toBeFocused();
  await expect(light).toHaveAttribute("aria-pressed", "false");
  const clip = await page.evaluate(() => {
    const column = document.querySelector("#gameCard footer")?.parentElement;
    if (!column) throw new Error("Missing Settings column for review capture");
    const bounds = column.getBoundingClientRect();
    const x = Math.max(0, Math.floor(bounds.left - 24));
    return {
      x,
      y: 0,
      width: Math.min(innerWidth - x, Math.ceil(bounds.width + 48)),
      height: Math.min(innerHeight, Math.ceil(bounds.bottom + 8)),
    };
  });
  await fs.mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(folder, "desktop-feedback-settings-dark.png"),
    clip,
    animations: "disabled",
  });
  await light.click();
  await expect(light).toHaveAttribute("aria-pressed", "true");
  const highlights = page.getByRole("switch", {
    name: "Recorded highlights",
    exact: true,
  });
  await highlights.scrollIntoViewIfNeeded();
  await highlights.focus();
  await expect(highlights).not.toBeChecked();
  const steamClip = await page.evaluate(() => {
    const group = document
      .querySelector('[aria-labelledby="leaderboard-settings"]')!
      .getBoundingClientRect();
    const x = Math.max(0, Math.floor(group.left - 24));
    const y = Math.max(0, Math.floor(group.top - 24));
    return {
      x,
      y,
      width: Math.min(innerWidth - x, Math.ceil(group.width + 48)),
      height: Math.min(innerHeight - y, Math.ceil(group.height + 48)),
    };
  });
  await page.screenshot({
    path: path.join(folder, "desktop-feedback-settings-light.png"),
    clip: steamClip,
    animations: "disabled",
  });
}

test.beforeEach(async () => {
  recoveredBrowser = undefined;
  profile = await createDesktopProfile();
  desktop = await launchDesktop(profile);
  await auditFeedbackAudio(desktop.page);
  await desktop.page.reload();
  await expect(
    desktop.page.getByRole("button", { name: "Play", exact: true }),
  ).toBeFocused();
  await focusGame();
});

test.afterEach(async ({}, testInfo) => {
  try {
    if (desktop && testInfo.status !== testInfo.expectedStatus) {
      const diagnostics = await desktopDeadline("Feedback diagnostics", () =>
        Promise.allSettled([
          feedbackAudio(desktop.page),
          desktop.page.evaluate(() => window.feedbackControllerAudit),
        ]),
      ).catch((reason) => [{ status: "rejected" as const, reason }]);
      const observed = diagnostics.map((result) =>
        result.status === "fulfilled"
          ? result.value
          : { unavailable: String(result.reason) },
      );
      await testInfo
        .attach("feedback-audit.json", {
          body: JSON.stringify({
            audio: observed[0],
            controller: observed[1],
            errors: desktop.errors,
            externalRequests: desktop.externalRequests,
            nativeLog: desktop.nativeLog,
          }),
          contentType: "application/json",
        })
        .catch(() => undefined);
    }
  } finally {
    try {
      if (desktop)
        await closeDesktop(desktop, {
          force: testInfo.status !== testInfo.expectedStatus,
        });
    } finally {
      try {
        await recoveredBrowser?.close().catch(() => undefined);
      } finally {
        if (profile) await removeDesktopProfile(profile);
      }
    }
  }
});

test("fresh desktop sound is on, local menu cues require user input, and saved mute remains silent", async () => {
  const { page } = desktop;
  await expect(
    page.getByRole("button", { name: "Turn on sound", exact: true }),
  ).toHaveCount(0);
  await settleInput(page);
  expect(await menuSources()).toHaveLength(0);
  await captureMenu();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: "Play with friends", exact: true }),
  ).toBeFocused();
  await expect
    .poll(async () => (await menuSources()).length)
    .toBeGreaterThan(0);
  const first = await menuSources();
  expect(first[0].url).toBe("electrify://app/audio/menu/select.wav");
  expect(first[0].duration).toBeGreaterThan(0);
  expect(first[0].duration).toBeLessThanOrEqual(0.2);
  expect(first[0].peak).toBeGreaterThan(0);
  expect(first[0].peak).toBeLessThanOrEqual(0.15);
  await expect
    .poll(async () => (await feedbackAudio(page)).contextStates)
    .toContain("running");
  const beforeHold = first.length;
  await page.keyboard.down("ArrowDown");
  for (let repeat = 0; repeat < 12; repeat++)
    await page.keyboard.down("ArrowDown");
  await page.keyboard.up("ArrowDown");
  await settleInput(page);
  expect((await menuSources()).length - beforeHold).toBeLessThanOrEqual(1);
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  const beforeFocus = (await menuSources()).length;
  await settings.focus();
  await settleInput(page);
  expect(await menuSources()).toHaveLength(beforeFocus);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      (await menuSources()).some((source) =>
        source.url.endsWith("/confirm.wav"),
      ),
    )
    .toBe(true);
  const sound = page.getByRole("switch", { name: "Sound", exact: true });
  await expect(sound).toBeChecked();
  await captureSettings();
  const beforeMute = (await menuSources()).length;
  await sound.uncheck();
  await settleInput(page);
  expect(await menuSources()).toHaveLength(beforeMute);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("audioEnabled")))
    .toBe("false");
  await page.reload();
  await focusGame();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Sound", exact: true }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await settleInput(page);
  expect(await menuSources()).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "Turn on sound", exact: true }),
  ).toHaveCount(0);
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
});

for (const crashAt of ["checkpoint", "warning"] as const) {
  test(`a renderer crash during the quit ${crashAt} restarts with the prior save and can then quit normally`, async ({}, testInfo) => {
    const { page, app } = desktop;
    await page.addInitScript(() =>
      localStorage.setItem("audioEnabled", "false"),
    );
    await page.goto("electrify://app/index.html?scenario=101");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.locator("#appbar:visible")).toBeVisible();
    await page.getByRole("button", { name: "pause", exact: true }).click();
    await expect.poll(async () => (await readSaveRecords(page)).length).toBe(1);
    const before = await readSavedGame(page);
    const originalId = (await readSaveRecords(page))[0].metadata.id;
    expect(before).toBeDefined();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            !!(await window.electrifyDesktop!.readSaveLibrary()).local,
        ),
      )
      .toBe(true);
    // Keep the real validated IPC handler/storage instance. Fail quit-phase writes
    // until the crash: an already-pending backup must not consume a one-shot fault
    // and leave the actual quit checkpoint free to succeed.
    await app.evaluate(({ app, BrowserWindow, dialog }, mode) => {
      const nativeRequire = process
        .getBuiltinModule("module")
        .createRequire(`${app.getAppPath()}/package.json`);
      const { DesktopSaveStore } = nativeRequire(
        `${app.getAppPath()}/electron/storage.cjs`,
      );
      const game = BrowserWindow.getAllWindows()[0];
      const audit = {
        windowId: game.id,
        quit: false,
        injected: false,
        backgroundPending: false,
        failedWrites: 0,
        crashes: 0,
        loads: 0,
        warnings: [] as Array<{ title: string; buttons: string[] }>,
      };
      Object.assign(globalThis, { feedbackQuitAudit: audit });
      let resumeBackground: (() => void) | undefined;
      const send = game.webContents.send;
      game.webContents.send = function (channel, ...arguments_) {
        if (channel === "desktop:before-quit") {
          audit.quit = true;
          resumeBackground?.();
        }
        return Reflect.apply(send, this, [channel, ...arguments_]);
      };
      game.webContents.on("did-finish-load", () => {
        audit.loads++;
      });
      const crash = async () => {
        const gone = new Promise<void>((resolve) =>
          game.webContents.once("render-process-gone", () => {
            audit.crashes++;
            resolve();
          }),
        );
        game.webContents.forcefullyCrashRenderer();
        await gone;
      };
      const write = DesktopSaveStore.prototype.write;
      DesktopSaveStore.prototype.write = async function (
        this: unknown,
        ...arguments_: unknown[]
      ) {
        if (mode === "warning" && !audit.quit && !audit.backgroundPending) {
          audit.backgroundPending = true;
          await new Promise<void>((resolve) => {
            resumeBackground = resolve;
          });
        }
        if (audit.quit && audit.crashes === 0) {
          const firstFailure = !audit.injected;
          audit.injected = true;
          audit.failedWrites++;
          if (mode === "checkpoint" && firstFailure) await crash();
          throw new Error("QA injected quit checkpoint failure");
        }
        return Reflect.apply(write, this, arguments_);
      };
      dialog.showMessageBox = (async (...arguments_: unknown[]) => {
        const options = arguments_[arguments_.length - 1] as {
          title: string;
          buttons: string[];
        };
        audit.warnings.push({ title: options.title, buttons: options.buttons });
        if (mode === "warning" && options.title === "Save before quitting")
          await crash();
        // Restart, or the old Retry choice after a renderer has crashed.
        return { response: 0, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    }, crashAt);
    if (crashAt === "warning") {
      // Force the CI race: a valid background backup reaches native storage before
      // Quit, but its write resumes only after the native quit broadcast.
      await page.evaluate(async () => {
        const desktop = window.electrifyDesktop!;
        const { local } = await desktop.readSaveLibrary();
        void desktop.writeSaveLibrary(local, false).catch(() => undefined);
      });
      await expect
        .poll(() =>
          app.evaluate(
            () =>
              (
                globalThis as unknown as {
                  feedbackQuitAudit: { backgroundPending: boolean };
                }
              ).feedbackQuitAudit.backgroundPending,
          ),
        )
        .toBe(true);
    }
    // Native close enters the same save handshake as Quit. Keep renderer-bound
    // Playwright operations out of the deliberately crashed execution context.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
    });
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (
              globalThis as unknown as {
                feedbackQuitAudit: { crashes: number; loads: number };
              }
            ).feedbackQuitAudit.crashes,
        ),
      )
      .toBe(1);
    // The surviving main process observes the actual reload before we attach a
    // fresh renderer driver to the same existing native window.
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (
              globalThis as unknown as {
                feedbackQuitAudit: { loads: number };
              }
            ).feedbackQuitAudit.loads,
        ),
      )
      .toBe(1);
    const recoveredDocument = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
        "({url: location.href, text: document.body.innerText, ready: document.readyState})",
      ),
    );
    await testInfo.attach("recovered-renderer-document.json", {
      body: JSON.stringify(recoveredDocument),
      contentType: "application/json",
    });
    // A Playwright Page stays crash-scoped after the native renderer reloads.
    // Reattach to the same existing window; no application window is recreated.
    const [port] = (
      await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")
    ).split(/\r?\n/);
    expect(port).toMatch(/^\d+$/);
    recoveredBrowser = await chromium.connectOverCDP(
      `http://127.0.0.1:${port}`,
    );
    const recoveredPages = recoveredBrowser.contexts()[0].pages();
    expect(recoveredPages).toHaveLength(1);
    const recoveredPage = recoveredPages[0];
    desktop.page = recoveredPage;
    recoveredPage.on("pageerror", (error) =>
      desktop.errors.push(error.message),
    );
    recoveredPage.on("request", (request) => {
      if (/^https?:/i.test(request.url()))
        desktop.externalRequests.push(request.url());
    });
    await expect(
      recoveredPage.getByRole("button", { name: "Continue", exact: true }),
    ).toBeVisible();
    const audit = await app.evaluate(
      () =>
        (
          globalThis as unknown as {
            feedbackQuitAudit: {
              windowId: number;
              backgroundPending: boolean;
              failedWrites: number;
              crashes: number;
              loads: number;
              warnings: Array<{ title: string; buttons: string[] }>;
            };
          }
        ).feedbackQuitAudit,
    );
    expect(audit.crashes).toBe(1);
    expect(audit.loads).toBe(1);
    expect(audit.failedWrites).toBeGreaterThanOrEqual(
      crashAt === "warning" ? 2 : 1,
    );
    expect(audit.backgroundPending).toBe(crashAt === "warning");
    expect(audit.warnings).toEqual([
      crashAt === "checkpoint"
        ? {
            title: "Restart or quit",
            buttons: ["Restart game", "Quit with previous save"],
          }
        : {
            title: "Save before quitting",
            buttons: [
              "Retry saving",
              "Return to game",
              "Quit with previous save",
            ],
          },
    ]);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => window.id),
      ),
    ).toEqual([audit.windowId]);
    await recoveredPage
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(recoveredPage.locator("#appbar:visible")).toBeVisible();
    const after = await readSavedGame(recoveredPage);
    expect(after?.date).toEqual(before?.date);
    expect(after?.facilities).toEqual(before?.facilities);
    expect((await readSaveRecords(recoveredPage))[0].metadata.id).toBe(
      originalId,
    );
    await recoveredPage
      .getByRole("button", { name: "menu", exact: true })
      .click();
    const closed = app.waitForEvent("close");
    await recoveredPage
      .getByRole("menuitem", { name: "Quit", exact: true })
      .click();
    await closed;
    await fs.mkdir(testInfo.outputDir, { recursive: true });
    const auditPath = testInfo.outputPath("renderer-crash-recovery.json");
    await fs.writeFile(
      auditPath,
      JSON.stringify({
        injected: crashAt,
        nativeWindowId: audit.windowId,
        crashes: audit.crashes,
        failedWrites: audit.failedWrites,
        backgroundPending: audit.backgroundPending,
        reloads: audit.loads,
        warnings: audit.warnings,
        originalSaveId: originalId,
        originalDate: before?.date,
        resumedDate: after?.date,
        observed:
          "One warning, renderer restarted, prior save resumed, normal quit succeeded",
      }),
    );
    await testInfo.attach("renderer-crash-recovery.json", {
      path: auditPath,
      contentType: "application/json",
    });
    expect(desktop.externalRequests).toEqual([]);
  });
}

test("zero Effects volume silences cached menu cues and persists independently of Sound", async () => {
  const { page } = desktop;
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect
    .poll(async () => (await menuSources()).length)
    .toBeGreaterThan(0);
  const effects = page.getByRole("slider", {
    name: "Effects volume",
    exact: true,
  });
  await effects.focus();
  await effects.press("Home");
  await expect(effects).toHaveAttribute("aria-valuenow", "0");
  const before = (await menuSources()).length;
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await settleInput(page);
  expect(await menuSources()).toHaveLength(before);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("soundEffectsVolume")))
    .toBe("0");
  await page.reload();
  await focusGame();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Sound", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("slider", { name: "Effects volume", exact: true }),
  ).toHaveAttribute("aria-valuenow", "0");
  await settleInput(page);
  expect(await menuSources()).toHaveLength(0);
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
});

test("an arrow immediately after leaving Settings cannot change the exiting volume slider", async ({}, testInfo) => {
  const { page } = desktop;
  await page.clock.install();
  await page.reload();
  await focusGame();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const effects = page.getByRole("slider", {
    name: "Effects volume",
    exact: true,
  });
  await effects.focus();
  await effects.press("Home");
  await expect(effects).toHaveAttribute("aria-valuenow", "0");
  await page.evaluate(() => {
    const events: Array<{
      key: string;
      tag: string;
      type: string;
      label: string;
    }> = [];
    Object.assign(window, { exitingSettingsKeyAudit: events });
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" && event.key !== "ArrowUp") return;
        const target = event.target as HTMLElement;
        events.push({
          key: event.key,
          tag: target.tagName,
          type: target.getAttribute("type") || "",
          label: target.getAttribute("aria-label") || "",
        });
      },
      true,
    );
  });
  await exitSettingsWithBodyArrow(page);
  const audit = await page.evaluate(() => ({
    events: (
      window as unknown as {
        exitingSettingsKeyAudit: Array<{
          key: string;
          tag: string;
          type: string;
          label: string;
        }>;
      }
    ).exitingSettingsKeyAudit,
    volume: localStorage.getItem("soundEffectsVolume"),
  }));
  await testInfo.attach("exiting-settings-key-targets.json", {
    body: JSON.stringify(audit),
    contentType: "application/json",
  });
  expect(audit.events.map((event) => event.key)).toEqual(["Escape", "ArrowUp"]);
  expect(audit.events[0].type).toBe("range");
  expect(audit.events[1].type).not.toBe("range");
  expect(audit.events[1].tag).toBe("BODY");
  expect(audit.volume).toBe("0");
  await page.clock.runFor(1000);
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeFocused();
  await page.clock.resume();
  await page.reload();
  await focusGame();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Effects volume", exact: true }),
  ).toHaveAttribute("aria-valuenow", "0");
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
});

test("mocked controller feedback is optional, bounded, independent of mute, and stops on native blur/disconnect/reduced motion", async ({}, testInfo) => {
  const { page, app } = desktop;
  await page.addInitScript(() => {
    localStorage.setItem("audioEnabled", "false");
    const audit: MockControllerAudit = {
      connected: true,
      reject: false,
      effects: [],
      resets: 0,
      events: [],
    };
    window.feedbackControllerAudit = audit;
    let nativeFocused: boolean | null = null;
    const observe = (kind: string) =>
      audit.events.push({
        kind,
        at: performance.now(),
        wallAt: Date.now(),
        focused: document.hasFocus(),
        visibility: document.visibilityState,
        nativeFocused,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        connected: audit.connected,
      });
    window.addEventListener("focus", () => observe("focus"));
    window.addEventListener("blur", () => observe("blur"));
    document.addEventListener("visibilitychange", () => observe("visibility"));
    document.addEventListener("click", () => observe("click"), true);
    window.electrifyDesktop?.onGameFocusChanged((focused) => {
      nativeFocused = focused;
      observe("native-focus");
    });
    const actuator = {
      type: "dual-rumble",
      playEffect: (type: string, parameters: GamepadEffectParameters) => {
        audit.effects.push({
          type,
          duration: parameters.duration || 0,
          strongMagnitude: parameters.strongMagnitude || 0,
          weakMagnitude: parameters.weakMagnitude || 0,
          at: performance.now(),
          wallAt: Date.now(),
        });
        return audit.reject
          ? Promise.reject(new Error("Unsupported actuator"))
          : Promise.resolve("complete");
      },
      reset: () => {
        audit.resets++;
        return Promise.resolve("complete");
      },
    };
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => {
        observe("get-gamepads");
        return audit.connected
          ? [{ connected: true, vibrationActuator: actuator }]
          : [];
      },
    });
  });
  await page.reload();
  // macOS fullscreen windows occupy a separate Space. Exercise native window
  // focus here without asynchronous Space switching from the auxiliary probe.
  await page.evaluate(async () => {
    const bridge = window.electrifyDesktop!;
    const { display } = await bridge.getState();
    await bridge.setDisplay({ ...display, fullscreen: false });
  });
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isFullScreen(),
      ),
    )
    .toBe(false);
  await focusGame();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const vibration = page.getByRole("switch", {
    name: "Controller vibration",
    exact: true,
  });
  await expect(vibration).not.toBeChecked();
  expect(
    await page.evaluate(() => window.feedbackControllerAudit.effects),
  ).toHaveLength(0);
  await vibration.check();
  const waitForCooldown = async () => {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const effects = window.feedbackControllerAudit.effects;
          return effects.length
            ? performance.now() - effects[effects.length - 1].at
            : Infinity;
        }),
      )
      .toBeGreaterThan(200);
  };
  const confirm = async () => {
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isFocused(),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => ({
          focused: document.hasFocus(),
          visibility: document.visibilityState,
          nativeEligible:
            window.feedbackControllerAudit.events.at(-1)?.nativeFocused !==
            false,
        })),
      )
      .toEqual({ focused: true, visibility: "visible", nativeEligible: true });
    await waitForCooldown();
    const previous = await page.evaluate(
      () => window.feedbackControllerAudit.effects.length,
    );
    await page
      .getByRole("group", { name: "Appearance", exact: true })
      .getByRole("button", { name: "Light", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => window.feedbackControllerAudit.effects.length),
      )
      .toBeGreaterThan(previous);
  };
  await confirm();
  const beforeBlur = await page.evaluate(
    () => window.feedbackControllerAudit.resets,
  );
  // Lose keyup outside the game: returning pointer input must remain usable.
  await page.keyboard.down("ArrowDown");
  await page.keyboard.down("ArrowDown");
  const windows = await app.evaluate(async ({ BrowserWindow }) => {
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
    await probe.loadURL(
      "data:text/html,<title>Feedback QA focus probe</title>",
    );
    probe.show();
    probe.focus();
    return { game: game.id, probe: probe.id };
  });
  try {
    await expect
      .poll(() =>
        app.evaluate(
          ({ BrowserWindow }, ids) =>
            BrowserWindow.fromId(ids.probe)!.isFocused() &&
            !BrowserWindow.fromId(ids.game)!.isFocused(),
          windows,
        ),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.feedbackControllerAudit.resets))
      .toBeGreaterThan(beforeBlur);
  } finally {
    await desktopDeadline(
      "Native focus handoff",
      () => app.evaluate(restoreFocusBeforeClosingProbe, windows),
      10_000,
    );
  }
  await focusGame();
  await confirm();
  await page.keyboard.up("ArrowDown");
  const beforeDisconnect = await page.evaluate(
    () => window.feedbackControllerAudit.resets,
  );
  await page.evaluate(() => {
    window.feedbackControllerAudit.connected = false;
    window.dispatchEvent(new Event("gamepaddisconnected"));
  });
  await expect
    .poll(() => page.evaluate(() => window.feedbackControllerAudit.resets))
    .toBeGreaterThan(beforeDisconnect);
  const unsupported = await page.evaluate(
    () => window.feedbackControllerAudit.effects.length,
  );
  await waitForCooldown();
  await page
    .getByRole("group", { name: "Appearance", exact: true })
    .getByRole("button", { name: "Light", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.feedbackControllerAudit.effects.length),
  ).toBe(unsupported);
  expect(
    await page.evaluate(
      () =>
        window.feedbackControllerAudit.events
          .filter((event) => event.kind === "get-gamepads")
          .at(-1)?.connected,
    ),
  ).toBe(false);
  await page.evaluate(() => {
    window.feedbackControllerAudit.connected = true;
  });
  await confirm();
  const beforeMotion = await page.evaluate(
    () => window.feedbackControllerAudit.resets,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => page.evaluate(() => window.feedbackControllerAudit.resets))
    .toBeGreaterThan(beforeMotion);
  const reduced = await page.evaluate(
    () => window.feedbackControllerAudit.effects.length,
  );
  await waitForCooldown();
  await page
    .getByRole("group", { name: "Appearance", exact: true })
    .getByRole("button", { name: "Light", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.feedbackControllerAudit.effects.length),
  ).toBe(reduced);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    window.feedbackControllerAudit.reject = true;
  });
  await confirm();
  await settleInput(page);
  const audit = await page.evaluate(() => window.feedbackControllerAudit);
  for (const effect of audit.effects) {
    expect(effect.type).toBe("dual-rumble");
    expect(effect.duration).toBeGreaterThan(0);
    expect(effect.duration).toBeLessThanOrEqual(100);
    expect(effect.strongMagnitude).toBeGreaterThan(0);
    expect(effect.strongMagnitude).toBeLessThanOrEqual(0.25);
    expect(effect.weakMagnitude).toBeGreaterThan(0);
    expect(effect.weakMagnitude).toBeLessThanOrEqual(0.25);
  }
  expect(await menuSources()).toHaveLength(0);
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
  await fs.mkdir(testInfo.outputDir, { recursive: true });
  const auditPath = testInfo.outputPath("controller-feedback-audit.json");
  await fs.writeFile(
    auditPath,
    JSON.stringify({ mockedActuator: true, ...audit }),
  );
  await testInfo.attach("controller-feedback-audit.json", {
    path: auditPath,
    contentType: "application/json",
  });
});

test("offline Recorded highlights preference persists and unsupported native Timeline APIs remain harmless", async () => {
  const { page, app } = desktop;
  // Resolve real bundled symbols without initializing Steam or claiming client support.
  const exports = await app.evaluate(({ app }) => {
    const nativeRequire = process
      .getBuiltinModule("module")
      .createRequire(`${app.getAppPath()}/package.json`);
    const api = nativeRequire(
      `${app.getAppPath()}/electron/steam-native.cjs`,
    ).loadTimelineFunctions();
    return api && Object.keys(api).sort();
  });
  expect(exports).toEqual([
    "clearDescription",
    "description",
    "event",
    "mode",
    "timeline",
  ]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const highlights = page.getByRole("switch", {
    name: "Recorded highlights",
    exact: true,
  });
  await expect(highlights).not.toBeChecked();
  await expect(page.getByText(/does not start video recording/)).toBeVisible();
  await highlights.check();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("steamTimelineEnabled")),
    )
    .toBe("true");
  const steam = await page.evaluate(async () => {
    const bridge = window.electrifyDesktop;
    if (!bridge?.setActivity || !bridge.addTimelineEvent)
      throw new Error("Missing scoped feedback bridge");
    await bridge.setActivity({
      phase: "playing",
      scenarioId: 103,
      year: 1,
      totalYears: 20,
      timelineEnabled: true,
    });
    await bridge.addTimelineEvent({
      runId: "qa-offline",
      eventId: "event-1",
      kind: "construction",
      scenarioId: 103,
      year: 1,
    });
    return (await bridge.getState()).steam;
  });
  expect(steam.available).toBe(false);
  expect(steam.timelineSupported).toBe(false);
  await page.reload();
  await focusGame();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Recorded highlights", exact: true }),
  ).toBeChecked();
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
});
