import { expect, test, Page, Locator } from "./fixtures";
import path from "node:path";
import { decodeSave } from "../src/SaveEncoding";
import type { SaveGameType } from "../src/Types";
import type {
  DesktopInputAction as InputAction,
  DesktopInputFrame as InputFrame,
} from "../src/Desktop";
import type { InstalledMod } from "../src/mods/Types";
import type { LobbyState } from "../src/multiplayer/Native";
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
  // Yield for DOM commits; each journey also awaits the action's observable result.
  // A frame alone does not establish dialog, native context, or text-entry readiness.
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
  await expect(control).toBeEnabled();
  const group = control.locator("..");
  if (
    (await control.getAttribute("tabindex")) === "-1" &&
    (await group.getAttribute("role")) === "group"
  ) {
    // Roving groups expose one vertical tab stop. Enter it before moving within
    // the group, just as a player does with the D-pad.
    const entry = group.locator('button[tabindex="0"]');
    await expect(entry).toHaveCount(1);
    await select(page, entry, "down", limit);
    const forward = await control.evaluate(
      (element) =>
        !!(
          document.activeElement!.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ),
    );
    const vertical =
      (await group.getAttribute("aria-orientation")) === "vertical";
    action = vertical ? (forward ? "down" : "up") : forward ? "right" : "left";
  }
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
    if (await control.evaluate((element) => element === document.activeElement))
      return;
    expect(
      expectedSurfaces,
      "directional focus traversal must not open an unexpected popup",
    ).toEqual(expect.arrayContaining(await popupSurfaces()));
    expect(
      await control.count(),
      "the target must remain available during navigation",
    ).toBe(1);
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
    // Keep game hazards independent of retries, wall time and worker scheduling.
    Math.random = () => 0.25;
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
    const selfId = "76561198000000001";
    let entries: InstalledMod[] = [
      {
        key: "workshop:777",
        source: "workshop",
        workshopId: "777",
        enabled: true,
        pack: {
          schemaVersion: 1,
          gameApi: 1,
          id: "deck-grid",
          title: "Deck Grid",
          creator: "QA",
          version: "1.0.0",
          description: "A small grid for controller checks.",
          seed: 42,
          baseScenarioId: 999,
        },
      },
    ];
    let lobby: LobbyState = {
      available: true,
      selfId,
      members: [],
      connected: [],
    };
    window.electrifyDesktop = {
      apiVersion: 1,
      getState: async () => ({
        display,
        steam: {
          available: true,
          online: true,
          cloudEnabled: false,
          steamId: selfId,
          displayName: "Deck player",
        },
      }),
      setDisplay: async () => display,
      mods: async (request) => {
        document.documentElement.dataset.mockModRequest = request.kind;
        if (request.kind === "enable")
          entries = entries.map((entry) =>
            entry.key === request.key
              ? { ...entry, enabled: request.enabled }
              : entry,
          );
        return { entries };
      },
      multiplayerRequest: async (request) => {
        document.documentElement.dataset.mockMultiplayerRequest = request.kind;
        if (request.kind === "list-saves")
          return { slots: [], cloudState: "disabled" };
        if (request.kind === "join") {
          document.documentElement.dataset.mockJoinedLobby = request.lobbyId;
          lobby = {
            ...lobby,
            lobbyId: request.lobbyId,
            hostId: "76561198000000002",
            members: [
              { id: selfId, name: "Deck player" },
              { id: "76561198000000002", name: "Friend" },
            ],
            connected: ["76561198000000002"],
          };
        }
        if (request.kind === "create")
          lobby = {
            ...lobby,
            lobbyId: "10977524123456789",
            hostId: selfId,
            members: [{ id: selfId, name: "Deck player" }],
            connected: [],
          };
        return lobby;
      },
      onMultiplayerEvent: noop,
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
      showTextInput: (request) => {
        document.documentElement.dataset.mockTextInput =
          JSON.stringify(request);
        return new Promise((resolve) => {
          window.addEventListener(
            "mockSteamTextResult",
            (event: Event) => {
              resolve((event as CustomEvent).detail);
            },
            { once: true },
          );
        });
      },
    };
  }, glyphs);
});

test("desktop home buttons share a width and Escape returns from menu pages", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Achievements", exact: true }),
  ).toHaveCount(0);
  const bounds = (await play.boundingBox())!;
  for (const button of await page.locator("#centeredMenu button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.width, await button.innerText()).toBeCloseTo(bounds.width, 0);
    expect(box.x, await button.innerText()).toBeCloseTo(bounds.x, 0);
  }
  if (
    process.env.REVIEW_SCREENSHOT_DIR &&
    testInfo.project.name === "deck-800-light"
  ) {
    await page.getByRole("button", { name: "Manual", exact: true }).focus();
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        "menu-steam-desktop.png",
      ),
      animations: "disabled",
    });
  }
  for (const title of ["Manual", "Settings", "Mods"]) {
    await page.getByRole("button", { name: title, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press("Escape");
    await expect(play).toBeVisible();
    await expect(page.locator(".screenPage")).toHaveCount(0);
  }
});

test("controller text entry searches the manual, cancels and restores field focus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-input-context",
    "Menu",
  );
  const manual = page.getByRole("button", { name: "Manual", exact: true });
  await select(page, manual);
  await input(page, "confirm");
  const search = page.getByRole("textbox", { name: "Search the manual" });
  await select(page, search);
  await input(page, "confirm");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-text-input",
    /Search the manual/,
  );
  // Direction and Back belong to the Steam keyboard until it dismisses.
  await input(page, "down");
  await input(page, "back");
  await expect(search).toBeFocused();
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("mockSteamTextResult", {
        detail: { status: "submitted", text: "blackouts" },
      }),
    );
  });
  await expect(search).toHaveValue("blackouts");
  await expect(search).toBeFocused();
  // Filtered results prove the React state received the native edit.
  await expect(page.locator("#manual-blackouts-header")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await input(page, "confirm");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-text-input",
    /"text":"blackouts"/,
  );
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.dispatchEvent(
      new CustomEvent("mockSteamTextResult", {
        detail: { status: "cancelled" },
      }),
    );
  });
  await expect(search).toHaveValue("blackouts");
  await expect(search).toBeFocused();
  await input(page, "down");
  await expect(search).not.toBeFocused();
});

test("semantic actions play, build, adjust pricing, inspect charts and save at Larger text size", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("textSize", "larger"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-input-context",
    "Menu",
  );
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
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
  if (
    (await page.locator(".gameStage").getAttribute("data-layout")) === "side"
  ) {
    await expect(build).toBeVisible();
    await select(
      page,
      build.getByRole("button", { name: "Close Build", exact: true }),
    );
    await input(page, "confirm");
  }
  await expect(build).toHaveCount(0);

  // Confirm lifts a reorder handle; directions must move the row rather than leave it.
  const rows = page.locator(".facilities:visible .facilityRow");
  const firstId = await rows.first().getAttribute("data-rfd-draggable-id");
  const grip = rows.first().getByRole("button", { name: /^Reorder / });
  await select(page, grip);
  await input(page, "confirm");
  await expect(page.locator(".facilityRow.dragging")).toHaveCount(1);
  await input(page, "down");
  await input(page, "confirm");
  await expect(page.locator(".facilityRow.dragging")).toHaveCount(0);
  await expect(rows.nth(1)).toHaveAttribute("data-rfd-draggable-id", firstId!);
  await input(page, "confirm");
  await expect(page.locator(".facilityRow.dragging")).toHaveCount(1);
  await input(page, "up");
  await input(page, "back");
  await expect(page.locator(".facilityRow.dragging")).toHaveCount(0);
  await expect(rows.nth(1)).toHaveAttribute("data-rfd-draggable-id", firstId!);

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
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await expect(page.locator(".MuiSnackbar-root")).toHaveCount(0);
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `steam-input-${testInfo.project.name}.png`,
      ),
      animations: "disabled",
    });
  }
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
  await select(
    page,
    page.getByRole("button", { name: "Saved games", exact: true }),
  );
  await input(page, "confirm");
  await select(
    page,
    page.getByRole("button", { name: /^Actions for / }).first(),
  );
  await input(page, "confirm");
  await select(
    page,
    page.getByRole("menuitem", { name: "Rename", exact: true }),
  );
  await input(page, "confirm");
  const saveName = page.getByRole("textbox", {
    name: "Save name",
    exact: true,
  });
  await select(page, saveName);
  await input(page, "confirm");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-text-input",
    /Save name/,
  );
  await submitText(page, "Deck renamed save", saveName);
  await select(page, page.getByRole("button", { name: "Rename", exact: true }));
  await input(page, "confirm");
  await expect(
    page.getByRole("article", { name: "Deck renamed save", exact: true }),
  ).toBeVisible();
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

async function submitText(page: Page, text: string, field: Locator) {
  await page.evaluate((text) => {
    window.dispatchEvent(
      new CustomEvent("mockSteamTextResult", {
        detail: { status: "submitted", text },
      }),
    );
  }, text);
  // Observe the real React edit and the controller's focus restoration before navigating.
  await expect(field).toHaveValue(text);
  await expect(field).toBeFocused();
}

async function chooseNewGame(page: Page) {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-input-context",
    "Menu",
  );
  await select(page, page.getByRole("button", { name: "Play", exact: true }));
  await input(page, "confirm");
  await expect(
    page.getByRole("heading", { name: "Choose a game", exact: true }),
  ).toBeVisible();
}

test("controller chooses an autocomplete city and starts a custom game", async ({
  page,
}) => {
  await chooseNewGame(page);
  await select(
    page,
    page.getByRole("button", { name: "View Custom Game details", exact: true }),
  );
  await input(page, "confirm");
  const search = page.getByRole("combobox", { name: "Search playable cities" });
  await select(page, search);
  await input(page, "confirm");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-text-input",
    /Search playable cities/,
  );
  await submitText(page, "Paris", search);
  await expect(
    page.getByRole("option", { name: "Paris, France", exact: true }),
  ).toBeVisible();
  await input(page, "down");
  await input(page, "confirm");
  await expect(search).toHaveValue("Paris, France");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(search).not.toBeFocused();
  await expect(page.locator('.worldMapMarker[tabindex="0"]')).toBeFocused();
  await select(page, page.locator('.worldMapMarker[tabindex="0"]'));
  await input(page, "back");
  await expect(
    page.getByRole("group", { name: "Map zoom controls" }).locator(":focus"),
  ).toHaveCount(1);
  await select(
    page,
    page
      .locator(".customSetupActions")
      .getByRole("button", { name: "Play", exact: true }),
  );
  await input(page, "confirm");
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await expect.poll(async () => (await readSaveRecords(page)).length).toBe(1);
  const save = decodeSave(
    (await readSaveRecords(page))[0].save,
  ) as SaveGameType;
  expect(save.game.location.name).toBe("Paris, France");
});

test("controller changes text size, keeps settings reachable and persists it", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-input-context",
    "Menu",
  );
  await select(
    page,
    page.getByRole("button", { name: "Settings", exact: true }),
  );
  await input(page, "confirm");
  const larger = page.getByRole("button", { name: "Larger", exact: true });
  await select(
    page,
    page.getByRole("button", { name: "Standard", exact: true }),
  );
  await input(page, "right");
  await input(page, "right");
  await expect(larger).toBeFocused();
  await input(page, "confirm");
  await expect(larger).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveCSS("font-size", "20px");
  await expect(page.getByText(/F11 or Alt\+Enter/)).toHaveCount(0);
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
        `text-size-${testInfo.project.name}.png`,
      ),
      animations: "disabled",
    });
  await input(page, "back");
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  await select(
    page,
    page.getByRole("button", { name: "Settings", exact: true }),
  );
  await input(page, "confirm");
  await expect(larger).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => localStorage.getItem("textSize"))).toBe(
    "larger",
  );
});

test("controller opens Workshop and enters a multiplayer invite with Steam text entry", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-input-context",
    "Menu",
  );
  await select(page, page.getByRole("button", { name: "Mods", exact: true }));
  await input(page, "confirm");
  const enabled = page.getByRole("switch", {
    name: "Deck Grid enabled",
    exact: true,
  });
  // Play appears once the mod's peak demand is prepared, after initial focus has settled below it.
  await select(
    page,
    page.getByRole("button", { name: "Play Deck Grid", exact: true }),
    "up",
  );
  await input(page, "right");
  await expect(enabled).toBeFocused();
  await input(page, "confirm");
  await expect(enabled).not.toBeChecked();
  await input(page, "confirm");
  await expect(enabled).toBeChecked();
  const browse = page.getByRole("button", {
    name: "Browse Workshop",
    exact: true,
  });
  await select(page, browse);
  await input(page, "confirm");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-mod-request",
    "browse",
  );
  await input(page, "back");
  await select(
    page,
    page.getByRole("button", { name: "Play with friends", exact: true }),
  );
  await input(page, "confirm");
  await expect(
    page.getByRole("dialog", { name: "Play with friends", exact: true }),
  ).toBeVisible();
  const code = page.getByRole("textbox", { name: "Invite code", exact: true });
  await select(page, code);
  await input(page, "confirm");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-text-input",
    /Invite code/,
  );
  await submitText(page, "10977524123456789", code);
  if (process.env.REVIEW_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `controller-invite-${testInfo.project.name}.png`,
      ),
      animations: "disabled",
    });
  await select(page, page.getByRole("button", { name: "Join", exact: true }));
  await input(page, "confirm");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-joined-lobby",
    "10977524123456789",
  );
  await expect(
    page.getByText("Waiting for Friend to choose a game…", { exact: true }),
  ).toBeVisible();
});

test("controller advances the first tutorial through inspection, chart and clock", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.removeItem("plays"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-input-context",
    "Menu",
  );
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeFocused();
  await input(page, "confirm");
  const hud = page.locator(".tutorialHud");
  await expect(hud).toBeVisible();
  await select(
    page,
    page.getByRole("button", { name: "Inspect Coal", exact: true }),
  );
  await input(page, "confirm");
  const chart = page.locator('#chartSupplyDemand [role="img"]');
  await select(page, chart);
  await input(page, "confirm");
  await expect(hud).toContainText("Demand rises as the city wakes up.");
  await select(page, page.getByRole("button", { name: "pause", exact: true }));
  await input(page, "right");
  await expect(
    page.getByRole("button", { name: "slow speed", exact: true }),
  ).toBeFocused();
  await input(page, "confirm");
  await expect(hud).toContainText(
    "Watch coal output climb slowly as sunlight fades.",
  );
  // Tutorial-hidden actions must stay unavailable through controller shortcuts too.
  await input(page, "build");
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(0);
});
