import { expect, test, Page, Locator } from "./fixtures";
import path from "node:path";
import { decodeSave } from "../src/SaveEncoding";
import type { SaveGameType } from "../src/Types";
import type {
  DesktopInputAction as InputAction,
  DesktopInputFrame as InputFrame,
} from "../src/Desktop";
import { readSaveRecords } from "./save-fixture";

const glyphs: InputFrame["glyphs"] = {
  up: { label: "D-pad up" },
  down: { label: "D-pad down" },
  left: { label: "D-pad left" },
  right: { label: "D-pad right" },
  confirm: { label: "A" },
  back: { label: "B" },
  pause: { label: "Y" },
  speedUp: { label: "Right stick up" },
  speedDown: { label: "Right stick down" },
  previousPane: { label: "LB" },
  nextPane: { label: "RB" },
  build: { label: "X" },
  previousChart: { label: "LT" },
  nextChart: { label: "RT" },
};

async function input(
  page: Page,
  action?: InputAction | InputAction[],
  connection?: Pick<InputFrame, "connected" | "disconnected">,
) {
  await page.evaluate(
    ({ action, connection, glyphs }) => {
      window.dispatchEvent(
        new CustomEvent("mockSteamInput", {
          detail: {
            connected: true,
            glyphs,
            actions: action ? (Array.isArray(action) ? action : [action]) : [],
            ...connection,
          },
        }),
      );
    },
    { action, connection, glyphs },
  );
  // Observe the real next render before sending another discrete button press.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

/** Find controls using only the controller's normal focus traversal. */
async function select(
  page: Page,
  control: Locator,
  action: InputAction = "down",
  limit = 100,
) {
  await expect(control).toBeVisible();
  const popupSurfaces = () =>
    page
      .locator('[role="dialog"],[role="menu"],[role="listbox"]')
      .filter({ visible: true })
      .evaluateAll((elements) =>
        elements.map((element) => ({
          role: element.getAttribute("role"),
          id: element.id,
          label: element.getAttribute("aria-label"),
        })),
      );
  const expectedSurfaces = await popupSurfaces();
  for (let index = 0; index < limit; index++) {
    expect(
      await popupSurfaces(),
      "directional focus traversal must not open an unexpected popup",
    ).toEqual(expectedSurfaces);
    expect(
      await control.count(),
      "the target must remain available during navigation",
    ).toBe(1);
    if (await control.evaluate((element) => element === document.activeElement))
      return;
    await input(page, action);
  }
  await expect(
    control,
    "reachable with semantic controller navigation",
  ).toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((glyphs) => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
    // A returning learner can choose a challenge from the real New Game catalog.
    localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [{ scenarioId: 1, date: "2026-01-01", timesPlayed: 1 }],
      }),
    );
    const noop = () => () => {};
    const display = {
      fullscreen: false,
      width: 1280,
      height: 800,
      resolutions: [{ width: 1280, height: 800 }],
    };
    const frame = {
      connected: true,
      actions: [],
      glyphs,
    };
    window.electrifyDesktop = {
      apiVersion: 1,
      getState: async () => ({
        display,
        steam: { available: true, online: true, cloudEnabled: false },
      }),
      setDisplay: async () => display,
      onStateChanged: noop,
      onGameFocusChanged: noop,
      onBeforeQuit: noop,
      readyToQuit: () => {},
      quit: async () => {},
      readSaveLibrary: async () => ({
        local: null,
        cloud: null,
        cloudState: "disabled",
      }),
      writeSaveLibrary: async () => ({ cloudState: "disabled" }),
      getLeaderboard: async () => [],
      submitScore: async () => {},
      openFriends: async () => {},
      setActivity: async () => {},
      addTimelineEvent: async () => {},
      setInputContext: async (context) => {
        document.documentElement.dataset.mockInputContext = context;
        return frame;
      },
      onInput: (callback) => {
        const handler = (event: Event) =>
          callback((event as CustomEvent<InputFrame>).detail);
        window.addEventListener("mockSteamInput", handler);
        return () => window.removeEventListener("mockSteamInput", handler);
      },
    };
  }, glyphs);
});

test("semantic actions play, build, adjust pricing, inspect charts and save without a mouse", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-input-context",
    "Menu",
  );
  await expect(
    page.getByRole("button", { name: "Start playing", exact: true }),
  ).toBeFocused();
  // A one-shot selection must survive a simultaneous held-direction repeat.
  await input(page, ["down", "confirm"]);
  await expect(
    page.getByRole("heading", { name: "Choose a game", exact: true }),
  ).toBeVisible();
  const scenario = page.getByRole("button", {
    name: "View Carbon Fee details",
    exact: true,
  });
  await select(page, scenario);
  await input(page, "confirm");
  const start = page.getByRole("button", { name: "Start game", exact: true });
  await select(page, start);
  await input(page, "confirm");
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-input-context",
    "Gameplay",
  );
  await expect.poll(async () => (await readSaveRecords(page)).length).toBe(1);
  const original = decodeSave(
    (await readSaveRecords(page))[0].save,
  ) as SaveGameType;

  await input(page, "build");
  const build = page.getByRole("region", { name: "Build", exact: true });
  await expect(build).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const review = build.getByRole("button", {
    name: "Review purchase of Solar",
    exact: true,
  });
  await select(page, review);
  await input(page, "confirm");
  const purchase = page.getByRole("dialog");
  await expect(purchase).toBeVisible();
  await select(
    page,
    purchase.getByRole("button", { name: "Take loan", exact: true }),
  );
  await input(page, "confirm");
  await expect(purchase).toHaveCount(0);
  await expect(build).toHaveCount(0);

  // From the fleet the pane ring reaches Build, then Programs at every viewport width.
  await input(page, "nextPane");
  await input(page, "nextPane");
  const programs = page.getByRole("region", { name: "Programs", exact: true });
  await expect(programs).toBeVisible();
  const rate = programs.getByRole("slider", {
    name: "The rate you charge for electricity generation",
    exact: true,
  });
  await select(page, rate);
  await expect(programs.locator(".MuiSlider-thumb:focus-within")).toHaveCSS(
    "outline-style",
    "solid",
  );
  const initialRate = Number(await rate.getAttribute("aria-valuenow"));
  await input(page, "right");
  await expect(rate).not.toHaveAttribute("aria-valuenow", String(initialRate));
  const changedRate = Number(await rate.getAttribute("aria-valuenow"));
  await expect(
    page.getByRole("complementary", { name: "Controller controls" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  if (process.env.REVIEW_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `steam-input-${testInfo.project.name}.png`,
      ),
      animations: "disabled",
    });
  // Programs → Insights → Events → Scenario → Fleet closes every retained side pane.
  for (let index = 0; index < 4; index++) await input(page, "nextPane");
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(0);
  await expect(programs).toHaveCount(0);
  await input(page, "nextChart");
  const chart = page.locator(
    '.accessibleChart > [role="img"][tabindex="0"]:focus',
  );
  await expect(chart).toBeFocused();
  await input(page, "confirm");
  await expect(chart.locator("..").getByRole("status")).not.toBeEmpty();
  await input(page, "right");
  await input(page, "back");

  const paused = page.getByRole("button", { name: "pause", exact: true });
  const wasPaused = (await paused.getAttribute("aria-pressed")) === "true";
  await input(page, "pause");
  await expect(paused).toHaveAttribute("aria-pressed", String(!wasPaused));
  await input(page, "speedUp");
  await expect(paused).toHaveAttribute("aria-pressed", "false");
  await input(page, undefined, { connected: false, disconnected: true });
  await expect(paused).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("status").filter({ hasText: "Controller disconnected" }),
  ).toBeVisible();
  await input(page);
  await expect(paused).toHaveAttribute("aria-pressed", "true");

  await input(page, "back");
  const quit = page.getByRole("menuitem", { name: "Save & Quit", exact: true });
  await select(page, quit);
  await input(page, "confirm");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible();
  const saved = decodeSave(
    (await readSaveRecords(page))[0].save,
  ) as SaveGameType;
  expect(saved.game.facilities).toHaveLength(
    original.game.facilities.length + 1,
  );
  expect(
    saved.game.facilities.some((facility) => facility.name === "Solar"),
  ).toBe(true);
  expect(saved.game.dollarsPerkWh).toBe(changedRate);
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-input-context",
    "Menu",
  );
});

test("controller hints follow the active device without blocking keyboard navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-input-context",
    "Menu",
  );
  const hints = page.getByRole("complementary", {
    name: "Controller controls",
  });
  await expect(hints).toHaveCount(0);
  await input(page, "down");
  await expect(hints).toBeVisible();
  await expect(hints).toContainText("A");
  await expect(hints).toContainText("Select");
  await page.keyboard.press("ArrowDown");
  await expect(hints).toHaveCount(0);
  await input(page, "up");
  await expect(hints).toBeVisible();
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  if (testInfo.project.use.hasTouch) await settings.tap();
  else await settings.click();
  await expect(hints).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
});
