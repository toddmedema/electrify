import { expect, test, Page, Locator, TestInfo } from "./fixtures";
import path from "node:path";
import { waitForDesktopTvEntry } from "./menu-keyboard";
import { foregroundContrast } from "./contrast";
import { decodeSave } from "../src/SaveEncoding";
import type { SaveGameType } from "../src/Types";
import type {
  DesktopInputAction as InputAction,
  DesktopInputFrame as InputFrame,
  DesktopState,
} from "../src/Desktop";
import type { InstalledMod } from "../src/mods/Types";
import type { LobbyState } from "../src/multiplayer/Native";
import { editSavedGame, readSavedGame, readSaveRecords } from "./save-fixture";

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
  const roving =
    (await control.getAttribute("tabindex")) === "-1" &&
    ["group", "tablist"].includes((await group.getAttribute("role")) ?? "");
  if (roving) {
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
  const visited = new Map<string, number>();
  for (let attempt = 0; attempt < limit; attempt++) {
    if (await control.evaluate((element) => element === document.activeElement))
      return;
    expect(
      await popupSurfaces(),
      "directional focus traversal must not open or dismiss a popup",
    ).toEqual(expectedSurfaces);
    expect(
      await control.count(),
      "the target must remain available during navigation",
    ).toBe(1);
    const movement = await control.evaluate((element) => {
      const target = element.getBoundingClientRect();
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body)
        return { direction: "down", key: "body" };
      const from = active.getBoundingClientRect();
      const sameRow =
        Math.min(from.bottom, target.bottom) >
        Math.max(from.top, target.top) +
          Math.min(from.height, target.height) / 2;
      const horizontal =
        sameRow &&
        !active.matches(
          'input[type="range"],select,[role="combobox"],.accessibleChart > [role="img"]',
        );
      return {
        direction: horizontal
          ? target.left > from.left
            ? "right"
            : "left"
          : target.top > from.top
            ? "down"
            : "up",
        key: `${active.tagName}/${active.id}/${active.getAttribute("aria-label")}/${active.textContent?.slice(0, 50)}/${active.parentElement?.textContent?.slice(0, 60)}`,
      };
    });
    const count = visited.get(movement.key) ?? 0;
    visited.set(movement.key, count + 1);
    const direction =
      count < 2
        ? roving
          ? action
          : movement.direction
        : ["down", "right", "up", "left"][count % 4];
    await input(page, direction as InputAction);
  }
  await expect(
    control,
    "reachable through the rendered control positions",
  ).toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((glyphs) => {
    if (sessionStorage.getItem("mockKeepPreferencesOnReload") !== "true")
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
          presentation: JSON.parse(
            sessionStorage.getItem("mockSteamPresentation") || "null",
          ) as DesktopState["steam"]["presentation"],
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
            lobbyId: "10977524123456789",
            inviteCode: request.lobbyId,
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
            inviteCode: "012345",
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
  await waitForDesktopTvEntry(page);
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

test("menu movement under a stationary pointer preserves keyboard navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#appStartup")).toHaveCount(0);
  await page.locator("#centeredMenu").evaluate(async (menu) => {
    await Promise.all(
      menu
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  const play = page.getByRole("button", { name: "Play", exact: true });
  const friends = page.getByRole("button", {
    name: "Play with friends",
    exact: true,
  });
  const manual = page.getByRole("button", { name: "Manual", exact: true });
  const tv = await waitForDesktopTvEntry(page);
  await friends.hover();
  await expect(friends).toBeFocused();
  await play.focus();
  await page.keyboard.press("ArrowDown");
  await expect(friends).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(tv).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(manual).toBeFocused();

  // Like the desktop entrance, move controls away and back beneath an unmoved mouse.
  await friends.evaluate((button) => {
    button.addEventListener(
      "pointerout",
      () => {
        button.dataset.pointerBoundary = "left";
      },
      { once: true },
    );
    button.addEventListener(
      "pointerover",
      () => {
        button.dataset.pointerBoundary = "returned";
      },
      { once: true },
    );
    document.getElementById("centeredMenu")!.style.transform =
      "translateX(10000px)";
  });
  // Observe both boundary events on the target button. A menu-wide :hover
  // check alone does not establish that this button will receive pointerover.
  await expect(friends).toHaveAttribute("data-pointer-boundary", "left");
  await expect(page.locator("#centeredMenu:hover")).toHaveCount(0);
  await page.locator("#centeredMenu").evaluate((menu) => {
    menu.style.transform = "none";
  });
  await expect(friends).toHaveAttribute("data-pointer-boundary", "returned");
  await expect(manual).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(tv).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(friends).toBeFocused();

  // Moving the mouse intentionally still selects the hovered control.
  await manual.hover();
  await expect(manual).toBeFocused();
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
  await expect(
    hints.getByRole("img", { name: "A", exact: true }),
  ).toBeVisible();
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
      .getByRole("button", { name: "Start game", exact: true }),
  );
  await input(page, "confirm");
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await expect.poll(async () => (await readSaveRecords(page)).length).toBe(1);
  const save = decodeSave(
    (await readSaveRecords(page))[0].save,
  ) as SaveGameType;
  expect(save.game.location.name).toBe("Paris, France");
});

test("controller changes interface scale, keeps settings reachable and persists it", async ({
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
  const scale = page.getByRole("combobox", {
    name: "Interface scale",
    exact: true,
  });
  await select(page, scale);
  await input(page, "down");
  await input(page, "down");
  await expect(scale).toBeFocused();
  await expect(scale).toHaveValue("1.25");
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
  await expect(scale).toHaveValue("1.25");
  expect(
    await page.evaluate(() => localStorage.getItem("interfaceScale")),
  ).toBe("1.25");
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
  const code = page.getByRole("textbox", {
    name: "6-digit invite code",
    exact: true,
  });
  await select(page, code);
  await input(page, "confirm");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-text-input",
    /6-digit invite code/,
  );
  await submitText(page, "012345", code);
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
    "012345",
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
  await select(page, hud.getByRole("button", { name: "Next", exact: true }));
  await input(page, "confirm");
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

test("controller reviews, cancels and confirms a utility acquisition", async ({
  page,
}) => {
  await page.goto("/?scenario=116");
  const start = page.getByRole("button", { name: "Start game", exact: true });
  await select(page, start);
  await input(page, "confirm");
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await input(page, "build");
  const build = page.getByRole("region", { name: "Build", exact: true });
  await select(
    page,
    build.getByRole("tab", { name: "Interties", exact: true }),
  );
  await input(page, "confirm");
  await select(
    page,
    build.getByRole("button", { name: /Review purchase of .*Ridge Electric/ }),
  );
  await input(page, "confirm");
  const dialog = page.getByRole("dialog");
  await select(
    page,
    dialog.getByRole("button", { name: "Take loan", exact: true }),
  );
  await input(page, "confirm");
  await expect(dialog).toHaveCount(0);
  // Fixture advances only construction; the acquisition still uses its real owning action.
  await editSavedGame(page, ({ game }) => {
    game.transmission!.lines[0].yearsToBuildLeft = 0;
    for (const tick of game.timeline) tick.cash = 1e9;
  });
  await page.goto("/");
  await select(
    page,
    page.getByRole("button", { name: "Continue", exact: true }),
  );
  await input(page, "confirm");
  const line = page
    .locator(".facilities:visible .transmissionLine")
    .filter({ hasText: "Ridge Electric" });
  await select(page, line.getByRole("button", { name: /^Inspect / }));
  await input(page, "confirm");
  const acquire = line.getByRole("button", {
    name: "Acquire Ridge Electric",
    exact: true,
  });
  await select(page, acquire);
  await input(page, "confirm");
  await expect(dialog).toHaveAccessibleName("Acquire Ridge Electric?");
  await input(page, "back");
  await expect(dialog).toHaveCount(0);
  await expect(acquire).toBeFocused();
  await input(page, "confirm");
  await select(
    page,
    dialog.getByRole("button", { name: "Take loan", exact: true }),
  );
  await input(page, "confirm");
  await expect(dialog).toHaveCount(0);
  await expect(line).toContainText("Owned · Ridge Electric");
  const saved = await readSavedGame(page);
  expect(
    saved?.utilityExpansion?.acquisitions.some(
      (receipt) => receipt.targetId === "ridge-electric",
    ),
  ).toBe(true);
});

test("TV layout keeps gameplay and controls readable with explicit device setup", async ({
  page,
}, info) => {
  await tvJourney(page, info, false);
});
test("TV maximum scale, Larger text and screen inset keep focused controls clear", async ({
  page,
}, info) => {
  await tvJourney(page, info, true);
});

test("controller help accepts pointer and physical keyboard activation without a layout preference", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-mock-input-context",
    "Menu",
  );
  const help = page.getByRole("button", { name: "All controls", exact: true });
  const dialog = page.getByRole("dialog", {
    name: "Controller controls",
    exact: true,
  });
  await input(page, "down");
  await help.click();
  await expect(dialog).toBeVisible();
  await expectControllerGlyphScale(
    dialog.getByRole("img", { name: "A", exact: true }),
  );
  await dialog
    .getByRole("button", { name: "Close controls", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await input(page, "down");
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
});

async function setupTv(page: Page, maximum: boolean, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-tv-layout", "false");
  const tv = page.getByRole("button", {
    name: "Playing on a TV? Use TV layout",
  });
  await select(page, tv);
  await input(page, "confirm");
  await expect(page.locator("html")).toHaveAttribute("data-tv-layout", "true");
  await select(
    page,
    page.getByRole("button", { name: "Settings", exact: true }),
  );
  await input(page, "confirm");
  await page
    .getByRole("combobox", { name: "Interface scale", exact: true })
    .selectOption(maximum ? "2.5" : "1.5");
  if (maximum) {
    await select(page, page.getByRole("button", { name: "4%", exact: true }));
    await input(page, "confirm");
  }
  await input(page, "back");
}

function skipNonTv(info: TestInfo) {
  test.skip(
    !info.project.name.startsWith("tv-"),
    "TV projects cover couch-scale layouts",
  );
}

async function captureTvPage(page: Page, info: TestInfo, name: string) {
  if (process.env.REVIEW_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `${info.project.name}-max-${name}.png`,
      ),
      animations: "disabled",
    });
}

async function expectControllerGlyphScale(glyph: Locator) {
  const sizes = await glyph.evaluate((element) => {
    // Both sources describe the same binding: fallback SVGs must retain the
    // readable size of native Steam images as TV and text scaling change.
    const native = document.createElement("img");
    native.className = "controllerGlyph";
    native.alt = "";
    element.after(native);
    try {
      const actual = element.getBoundingClientRect();
      const expected = native.getBoundingClientRect();
      return {
        actual: { width: actual.width, height: actual.height },
        expected: { width: expected.width, height: expected.height },
      };
    } finally {
      native.remove();
    }
  });
  expect(sizes.actual).toEqual(sizes.expected);
  expect(sizes.actual.height).toBeGreaterThan(24);
}

test("TV saved preferences style direct scenario links before play", async ({
  page,
}, info) => {
  skipNonTv(info);
  await page.addInitScript(() => {
    const savedTv = () => {
      localStorage.setItem("tvMode", "true");
      localStorage.setItem("tvScale", "2");
      localStorage.setItem("tvInset", "4");
      localStorage.setItem("textSize", "larger");
    };
    // The shared bridge fixture clears preferences. Preserve this explicit saved-TV setup
    // independently of init-script execution order, as the cloud-invitation fixture does.
    const clear = Storage.prototype.clear;
    Storage.prototype.clear = function () {
      clear.call(this);
      if (this === localStorage) savedTv();
    };
    savedTv();
  });
  await page.goto("/?scenario=116");
  const start = page.getByRole("button", { name: "Start game", exact: true });
  await expect(start).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-tv-layout", "true");
  const edge = await page.locator(".appFrame").evaluate((element) => ({
    actual: parseFloat(getComputedStyle(element).paddingTop),
    expected: Math.min(innerWidth, innerHeight) * 0.04,
  }));
  expect(
    edge.actual,
    "TV geometry must be loaded on the first direct-link screen",
  ).toBeCloseTo(edge.expected, 1);
  await start.press("Enter");
  await expect(page.locator(".gameStage")).toHaveAttribute(
    "data-layout",
    "single",
  );
  await expect(page.locator("#appbar:visible")).toBeVisible();
  const warning = page.locator(".missionSummary.statusWarning");
  await expect(warning).toBeVisible();
  expect(
    await foregroundContrast(warning.locator(".missionRiskButton")),
    "mission warning text keeps contrast on its amber surface",
  ).toBeGreaterThanOrEqual(4.5);
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("tab", { name: "Interties", exact: true }).click();
  const metrics = page.locator(".transmissionProject .buildOptionMetric");
  await expect(metrics.first()).toBeVisible();
  for (const metric of await metrics.all()) {
    expect(
      await metric.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
      "intertie values stay within their own metric column",
    ).toBeLessThanOrEqual(1);
  }
  await page.getByRole("button", { name: "Events", exact: true }).click();
  const goalWidth = await page
    .locator(".operationsPriorities")
    .evaluate((element) => ({
      goals: element.getBoundingClientRect().width,
      pane: element.closest(".eventLog")!.getBoundingClientRect().width,
    }));
  expect(goalWidth.goals, "goals use the TV reading column").toBeGreaterThan(
    goalWidth.pane * 0.9,
  );
  await page.getByRole("button", { name: "Insights", exact: true }).click();
  await page.locator(".insightsTrackHeader .manual-link").first().click();
  const help = page.getByRole("dialog", { name: "Manual help", exact: true });
  await expect(
    help.getByRole("button", { name: "close", exact: true }),
  ).toBeVisible();
  const helpBounds = await help.boundingBox();
  expect(
    helpBounds!.width,
    "TV help uses a readable article width",
  ).toBeGreaterThan(page.viewportSize()!.width / 2);
  expect(
    helpBounds!.y,
    "help stays inside the screen inset",
  ).toBeGreaterThanOrEqual(edge.actual);
  expect(
    helpBounds!.y + helpBounds!.height,
    "help clears the controller footer",
  ).toBeLessThan(page.viewportSize()!.height - edge.actual - 80);
  await help.getByRole("button", { name: "close", exact: true }).click();
});

test("TV maximum tutorial keeps instruction and explanation on separate readable lines", async ({
  page,
}, info) => {
  skipNonTv(info);
  await setupTv(
    page,
    true,
    info.project.use.colorScheme === "dark" ? "dark" : "light",
  );
  await page.getByRole("button", { name: "Play", exact: true }).press("Enter");
  await page
    .getByRole("button", { name: "Start Electricity", exact: true })
    .press("Enter");
  const hud = page.locator(".tutorialHud");
  await expect(hud).toBeVisible();
  await input(page, "down");
  const geometry = await hud.evaluate((element) => {
    const action = element.querySelector(".tutorialHudAction")!;
    const prompt = element.querySelector(".tutorialPrompt")!;
    const textBounds = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect();
    };
    const title = textBounds(action),
      body = textBounds(prompt);
    const style = getComputedStyle(prompt);
    return {
      gap: body.top - title.bottom,
      lineRatio: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
    };
  });
  expect(
    geometry.gap,
    "instruction and explanation glyphs must not overlap",
  ).toBeGreaterThanOrEqual(0);
  expect(
    geometry.lineRatio,
    "wrapped explanation needs readable leading",
  ).toBeGreaterThanOrEqual(1.2);
  await input(page);
  await captureTvPage(page, info, "tutorial");
});

test("TV maximum custom setup gives location and select values enough room", async ({
  page,
}, info) => {
  skipNonTv(info);
  await setupTv(
    page,
    true,
    info.project.use.colorScheme === "dark" ? "dark" : "light",
  );
  await page.getByRole("button", { name: "Play", exact: true }).press("Enter");
  await page
    .getByRole("button", { name: "View Custom Game details", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: "Custom setup", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#location")).not.toHaveValue("");
  await input(page, "down");
  const geometry = await page.locator(".locationPicker").evaluate((element) => {
    const search = element.querySelector<HTMLInputElement>("input")!;
    const label = element.querySelector("label")!;
    const map = element.querySelector(".worldMap")!;
    const controls = element.querySelector(".worldMapControls")!;
    const count = element.querySelector(".locationPickerCount")!;
    const style = getComputedStyle(search);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = style.font;
    const textWidth = context.measureText(search.value).width;
    const mapBounds = map.getBoundingClientRect(),
      controlsBounds = controls.getBoundingClientRect();
    const countStyle = getComputedStyle(count);
    return {
      inputRoom:
        search.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        textWidth,
      labelGap:
        search.getBoundingClientRect().top +
        parseFloat(style.paddingTop) -
        label.getBoundingClientRect().bottom,
      controlShare:
        (controlsBounds.width * controlsBounds.height) /
        (mapBounds.width * mapBounds.height),
      countLines:
        count.getBoundingClientRect().height /
        parseFloat(countStyle.lineHeight),
      widthShare: element.getBoundingClientRect().width / innerWidth,
    };
  });
  expect(
    geometry.inputRoom,
    "selected city must fit without truncation",
  ).toBeGreaterThanOrEqual(0);
  expect(
    geometry.labelGap,
    "floating city label must clear input text",
  ).toBeGreaterThanOrEqual(0);
  expect(
    geometry.controlShare,
    "zoom controls must leave the map readable",
  ).toBeLessThan(0.25);
  expect(
    geometry.countLines,
    "location count must remain a compact line",
  ).toBeLessThanOrEqual(1.1);
  expect(
    geometry.widthShare,
    "custom setup must use the shared TV reading width",
  ).toBeGreaterThan(0.8);
  await input(page);
  await captureTvPage(page, info, "custom");
  for (const name of ["Starting year", "Duration"]) {
    const selectControl = page.getByRole("combobox", { name, exact: true });
    // Only scroll the screen's reading pane; native scrollIntoView also moves the fixed shell.
    await selectControl.evaluate((element) => {
      const pane = element.closest<HTMLElement>(".scrollable")!;
      const view = pane.getBoundingClientRect(),
        control = element.getBoundingClientRect();
      const gap = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      if (control.bottom > view.bottom)
        pane.scrollTop += control.bottom - view.bottom + gap;
      else if (control.top < view.top)
        pane.scrollTop += control.top - view.top - gap;
    });
    const clearance = await selectControl.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const icon = element.parentElement!.querySelector(".MuiSelect-icon")!;
      return (
        icon.getBoundingClientRect().left - range.getBoundingClientRect().right
      );
    });
    expect(
      clearance,
      `${name}: selected text must clear the dropdown arrow`,
    ).toBeGreaterThan(0);
  }
  await captureTvPage(page, info, "custom-fields");
});

async function tvJourney(page: Page, testInfo: TestInfo, maximum: boolean) {
  test.skip(
    !testInfo.project.name.startsWith("tv-"),
    "TV projects cover couch-scale layouts",
  );
  for (const theme of [
    testInfo.project.use.colorScheme === "dark" ? "dark" : "light",
  ] as const) {
    await setupTv(page, maximum, theme);
    await select(
      page,
      page.getByRole("button", { name: /^(Play|New game)$/, exact: true }),
    );
    await input(page, "confirm");
    await select(
      page,
      page.getByRole("button", {
        name: "View Carbon Fee details",
        exact: true,
      }),
    );
    await input(page, "confirm");
    await select(
      page,
      page.getByRole("button", { name: "Start game", exact: true }),
    );
    await input(page, "confirm");
    await expect(page.locator("#appbar:visible")).toBeVisible();
    await expect(page.locator(".gameStage")).toHaveAttribute(
      "data-layout",
      "single",
    );
    const capture = async (view: string) => {
      await expect(page.locator(".base_main")).toHaveCount(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      const focusBounds = async () =>
        page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          if (
            !active ||
            active === document.body ||
            active.matches("h1,h2,h3,h4,h5,h6")
          )
            return null;
          // MUI uses enlarged invisible inputs for slider/switch hit areas; measure the visible widget.
          const target =
            active.closest<HTMLElement>(".MuiSlider-root,.MuiSwitch-root") ??
            active;
          const rect = target.getBoundingClientRect();
          let left = 0,
            top = 0,
            right = innerWidth,
            bottom = innerHeight;
          for (
            let parent = target.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            const style = getComputedStyle(parent);
            const bounds = parent.getBoundingClientRect();
            if (style.overflowX !== "visible") {
              left = Math.max(left, bounds.left);
              right = Math.min(right, bounds.right);
            }
            if (style.overflowY !== "visible") {
              top = Math.max(top, bounds.top);
              bottom = Math.min(bottom, bounds.bottom);
            }
          }
          return {
            label: active.getAttribute("aria-label") ?? active.textContent,
            left: rect.left - left,
            top: rect.top - top,
            right: right - rect.right,
            bottom: bottom - rect.bottom,
          };
        });
      await expect
        .poll(
          async () => {
            const bounds = await focusBounds();
            return bounds
              ? Math.min(bounds.left, bounds.top, bounds.right, bounds.bottom)
              : 0;
          },
          {
            message: `${view}: focused control settles inside its scroll viewport`,
          },
        )
        .toBeGreaterThanOrEqual(-1);
      const focusedBounds = await focusBounds();
      if (focusedBounds)
        for (const side of ["left", "top", "right", "bottom"] as const)
          expect(
            focusedBounds[side],
            `${view}: focused ${focusedBounds.label} clears ${side}`,
          ).toBeGreaterThanOrEqual(-1);
      if (process.env.REVIEW_SCREENSHOT_DIR) {
        await page.screenshot({
          path: path.join(
            process.env.REVIEW_SCREENSHOT_DIR,
            `${testInfo.project.name}-${maximum ? "max-" : ""}${view}.png`,
          ),
          animations: "disabled",
        });
      }
    };
    await select(
      page,
      page.getByRole("button", { name: "Build", exact: true }),
    );
    await input(page, "right");
    await expect(
      page.getByRole("button", { name: "Programs", exact: true }),
    ).toBeFocused();
    await input(page, "left");
    await expect(
      page.getByRole("button", { name: "Build", exact: true }),
    ).toBeFocused();
    await capture("fleet");
    const inspect = page.getByRole("button", {
      name: "Inspect Coal",
      exact: true,
    });
    await select(page, inspect);
    await input(page, "confirm");
    await capture("fleet-expanded");
    await input(page, "build");
    const build = page.getByRole("region", { name: "Build", exact: true });
    await expect(page.locator(".gameFleet")).toBeHidden();
    const gridContext = build.locator("summary");
    await select(page, gridContext);
    await input(page, "confirm");
    const gridChart = build.getByRole("img", {
      name: /Chart of electricity supply and demand over the day/,
    });
    await select(page, gridChart);
    await input(page, "confirm");
    await capture("build-forecast");
    await input(page, "back");
    await select(page, gridContext);
    await input(page, "confirm");
    const compareSolar = build.getByRole("button", {
      name: "Compare Solar",
      exact: true,
    });
    await select(page, compareSolar);
    await input(page, "confirm");
    const comparison = build.getByRole("region", {
      name: "Generator comparison",
    });
    await expect(comparison).toContainText("Solar");
    await select(
      page,
      comparison.getByRole("button", { name: "Clear", exact: true }),
    );
    await capture("comparison");
    await select(
      page,
      build.getByRole("button", {
        name: "Review purchase of Solar",
        exact: true,
      }),
    );
    const reviewSolar = build.getByRole("button", {
      name: "Review purchase of Solar",
      exact: true,
    });
    const scrollBefore = await build
      .locator(".gameToolBody,ul.cardList")
      .evaluateAll((elements) => elements.map((element) => element.scrollTop));
    await input(page, "nextPane");
    await expect(
      page.getByRole("region", { name: "Programs", exact: true }),
    ).toBeVisible();
    await input(page, "previousPane");
    await expect(reviewSolar).toBeFocused();
    await expect
      .poll(() =>
        build
          .locator(".gameToolBody,ul.cardList")
          .evaluateAll((elements) =>
            elements.map((element) => element.scrollTop),
          ),
      )
      .toEqual(scrollBefore);
    await build.evaluate((region) => {
      const remember = (element: Element | null) => {
        if (!element || !region.contains(element)) return;
        document.documentElement.dataset.reviewReturnControl = JSON.stringify({
          tag: element.tagName.toLowerCase(),
          label: element.getAttribute("aria-label"),
          text: element.textContent,
        });
      };
      remember(document.activeElement);
      region.addEventListener("focusin", (event) =>
        remember(event.target as Element),
      );
    });
    await select(page, page.getByRole("button", { name: "menu", exact: true }));
    const menuReturnControl = JSON.parse(
      (await page.locator("html").getAttribute("data-review-return-control"))!,
    );
    const menuScrollBefore = await build
      .locator(".gameToolBody,ul.cardList")
      .evaluateAll((elements) => elements.map((element) => element.scrollTop));
    await input(page, "confirm");
    await select(
      page,
      page.getByRole("menuitem", { name: "Settings", exact: true }),
    );
    await input(page, "confirm");
    await expect(page.locator(".gameWorkspace")).toHaveCount(0);
    await expect(page.locator(".base_main")).toHaveCount(1);
    await input(page, "back");
    const returned = menuReturnControl.label
      ? build.getByLabel(menuReturnControl.label, { exact: true })
      : build
          .locator(menuReturnControl.tag)
          .filter({ hasText: menuReturnControl.text });
    await expect(returned).toBeFocused();
    await expect
      .poll(() =>
        build
          .locator(".gameToolBody,ul.cardList")
          .evaluateAll((elements) =>
            elements.map((element) => element.scrollTop),
          ),
      )
      .toEqual(menuScrollBefore);
    await select(page, reviewSolar);
    await input(page, "confirm");
    const purchase = page.getByRole("dialog");
    await expect(purchase).toBeVisible();
    await select(
      page,
      purchase.getByRole("button", { name: "Take loan", exact: true }),
    );
    await capture("purchase");
    await input(page, "back");
    await expect(purchase).toHaveCount(0);
    await input(page, "back");
    await expect(build).toHaveCount(0);
    await select(
      page,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    await input(page, "confirm");
    await expect(
      page.getByRole("region", { name: "Insights", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".gameToolPanel:visible")).toHaveCount(1);
    await expect(page.locator(".uplot:visible").first()).toBeVisible();
    const insightRows = await page
      .locator(".insights:visible")
      .evaluate((view) => {
        const bounds = (selector: string) =>
          view.querySelector(selector)!.getBoundingClientRect();
        const date = bounds(".insightsViewportDate");
        const buttons = bounds(".insightsViewportButtons");
        const control = bounds(".insightsViewportButtons button");
        const title = bounds(".insightEventTitle");
        const eventDate = bounds(".insightEventDate");
        const legend = bounds(".insightsTrack .chartLegend");
        const chart = bounds(".insightsTrack .accessibleChart > [role=img]");
        return {
          dateControlAlignment: Math.abs(
            date.top + date.height / 2 - (control.top + control.height / 2),
          ),
          controlOverflow: control.bottom - buttons.bottom,
          eventLineGap: eventDate.top - title.bottom,
          legendChartGap: chart.top - legend.bottom,
          chartBottom: chart.bottom,
          paneBottom: view.closest(".gameToolBody")!.getBoundingClientRect()
            .bottom,
          textScale: parseFloat(
            getComputedStyle(document.documentElement).fontSize,
          ),
        };
      });
    expect(
      insightRows.dateControlAlignment,
      "range and graph controls share a row center",
    ).toBeLessThanOrEqual(1);
    expect(
      insightRows.controlOverflow,
      "timeline controls fit their owning row",
    ).toBeLessThanOrEqual(1);
    expect(
      insightRows.eventLineGap,
      "event title and date have separate readable lines",
    ).toBeGreaterThanOrEqual(insightRows.textScale / 8);
    expect(
      insightRows.legendChartGap,
      "the focused chart clears its legend",
    ).toBeGreaterThanOrEqual(insightRows.textScale / 4);
    if (!maximum)
      expect(
        insightRows.chartBottom,
        "the first TV plot and time axis fit below the shared controls",
      ).toBeLessThanOrEqual(insightRows.paneBottom);
    await capture("insights");
    const chart = page
      .locator('.accessibleChart > [role="img"][tabindex="0"]:visible')
      .first();
    await select(page, chart);
    await input(page, "confirm");
    await input(page, "right");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Supply|Demand/ })
        .first(),
    ).toBeVisible();
    const pointValues = page.locator(".chartTooltip:visible").first();
    await expect(pointValues).toBeVisible();
    await expect
      .poll(
        () =>
          pointValues.evaluate(
            (element) => element.scrollHeight - element.clientHeight,
          ),
        {
          message:
            "all selected chart values remain visible without pointer scrolling",
        },
      )
      .toBeLessThanOrEqual(1);
    await capture("chart-values");
    await input(page, "back");
    await input(page, "back");
    const programs = page.getByRole("button", {
      name: "Programs",
      exact: true,
    });
    await select(page, programs);
    await input(page, "confirm");
    const rate = page.getByRole("slider", { name: /rate|price/i }).first();
    await select(page, rate);
    await capture("pricing");
    await input(page, "back");
    await select(
      page,
      page.getByRole("button", { name: "Events", exact: true }),
    );
    await input(page, "confirm");
    await capture("events");
    await input(page, "back");
    await select(
      page,
      page.getByRole("button", { name: "All controls", exact: true }),
    );
    await input(page, "confirm");
    await expect(
      page.getByRole("dialog", { name: "Controller controls" }),
    ).toBeVisible();
    await expectControllerGlyphScale(
      page
        .getByRole("dialog", { name: "Controller controls" })
        .getByRole("img", { name: "A", exact: true }),
    );
    await page.evaluate(
      (glyphs) =>
        window.dispatchEvent(
          new CustomEvent("mockSteamInput", {
            detail: {
              connected: true,
              actions: [],
              glyphs: { ...glyphs, confirm: { label: "Remapped select" } },
            },
          }),
        ),
      glyphs,
    );
    await expect(
      page.getByRole("dialog", { name: "Controller controls" }),
    ).toContainText("Remapped select");
    await capture("controls");
    await input(page, "back");
    await expect(
      page.getByRole("dialog", { name: "Controller controls" }),
    ).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute(
      "data-mock-input-context",
      "Gameplay",
    );
    await input(page, undefined, { connected: false, disconnected: true });
    await expect(
      page.getByRole("status").filter({ hasText: "Controller disconnected" }),
    ).toBeVisible();
    await capture("disconnect");
    await input(page, undefined, { connected: true });
    await expect(
      page.getByRole("button", { name: "pause", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await select(page, page.getByRole("button", { name: "menu", exact: true }));
    await input(page, "confirm");
    await select(
      page,
      page.getByRole("menuitem", { name: "Settings", exact: true }),
    );
    await input(page, "confirm");
    const sound = page.getByRole("switch", { name: "Sound", exact: true });
    await select(page, sound);
    const settingsHints = page.getByRole("complementary", {
      name: "Controller controls",
    });
    await expect(
      settingsHints.getByText("Select", { exact: true }),
    ).toBeVisible();
    await expect(settingsHints).not.toContainText("Edit text");
    await capture("settings");
    await expect(sound).not.toBeChecked();
    await input(page, "confirm");
    await expect(sound).toBeChecked();
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-mock-text-input",
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-mock-input-context",
      "Menu",
    );
    await input(page, "confirm");
    await expect(sound).not.toBeChecked();
    await input(page, "back");
    await select(page, page.getByRole("button", { name: "menu", exact: true }));
    await input(page, "confirm");
    await select(
      page,
      page.getByRole("menuitem", { name: "Manual", exact: true }),
    );
    await input(page, "confirm");
    const search = page.getByRole("textbox", { name: "Search the manual" });
    await select(page, search);
    await input(page, "confirm");
    await expect(page.locator("html")).toHaveAttribute(
      "data-mock-text-input",
      /Search the manual/,
    );
    // The native text surface is replaced by the bridge; accepted Unicode must return to the actual field.
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("mockSteamTextResult", {
          detail: { status: "submitted", text: "électricité" },
        }),
      ),
    );
    await expect(search).toHaveValue("électricité");
    await expect(search).toBeFocused();
    await capture("text-entry-return");
  }
}

for (const source of ["big-picture", "remote-play-tv"] as const) {
  test(`TV first launch suggests ${source} and remembers the player's choice`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "tv-1080-dark");
    await page.addInitScript((source) => {
      sessionStorage.setItem(
        "mockSteamPresentation",
        JSON.stringify({
          bigPicture: source === "big-picture",
          remotePlayTv: source === "remote-play-tv",
          steamDeck: false,
        }),
      );
    }, source);
    await page.goto("/");
    const suggestion = page.getByRole("dialog", { name: "Playing on a TV?" });
    await expect(suggestion).toBeVisible();
    await expect(page.locator("#appStartup")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute(
      "data-mock-input-context",
      "Menu",
    );
    await expect(
      suggestion.getByRole("button", { name: "Use TV layout", exact: true }),
    ).toBeFocused();
    await expect(page.locator("html")).toHaveAttribute(
      "data-tv-layout",
      "false",
    );
    const useTv = source === "big-picture";
    if (useTv) await input(page, "confirm");
    else
      await suggestion
        .getByRole("button", { name: "Keep desktop layout", exact: true })
        .press("Enter");
    await expect(suggestion).not.toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-tv-layout",
      String(useTv),
    );
    expect(await page.evaluate(() => localStorage.getItem("tvMode"))).toBe(
      String(useTv),
    );
    // Retain the actual device storage instead of resetting this fresh-page fixture.
    await page.evaluate(() =>
      sessionStorage.setItem("mockKeepPreferencesOnReload", "true"),
    );
    await page.reload();
    await waitForDesktopTvEntry(page);
    await expect(suggestion).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute(
      "data-tv-layout",
      String(useTv),
    );
  });
}

test("TV first launch leaves handheld Steam Deck layout unchanged in Big Picture", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "deck-800-dark");
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "mockSteamPresentation",
      JSON.stringify({
        bigPicture: true,
        steamDeck: true,
        remotePlayTv: false,
      }),
    );
  });
  await page.goto("/");
  await waitForDesktopTvEntry(page);
  await expect(
    page.getByRole("dialog", { name: "Playing on a TV?" }),
  ).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-tv-layout", "false");
  expect(await page.evaluate(() => localStorage.getItem("tvMode"))).toBeNull();
  // Handheld protection does not prevent a player explicitly choosing TV for a dock.
  await page
    .getByRole("button", {
      name: "Playing on a TV? Use TV layout",
      exact: true,
    })
    .press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-tv-layout", "true");
});
