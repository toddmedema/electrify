import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import type { InstalledMod, ModLibrary, ModRequest } from "../src/mods/Types";
import { openPane } from "./layout";

declare global {
  interface Window {
    __mods: {
      requests: ModRequest[];
      scores: number;
      finishUpload?: () => void;
    };
  }
}

const pack = (patch: Partial<InstalledMod["pack"]>) => ({
  schemaVersion: 1 as const,
  gameApi: 1,
  id: "community-grid",
  title: "Community Grid",
  creator: "Community author",
  version: "1.0.0",
  seed: 42,
  baseScenarioId: 999,
  ...patch,
});
const ENTRIES: InstalledMod[] = [
  {
    key: "local:community-grid",
    source: "local",
    enabled: true,
    pack: pack({
      // A tenfold faster solar build is visible on the Build catalog.
      facilities: { Solar: { yearsToBuild: 0.1 } },
      programs: { efficiency: 0.8 },
    }),
  },
  {
    key: "local:old-grid",
    source: "local",
    enabled: true,
    pack: pack({ id: "old-grid", title: "Old Grid", gameApi: 2 }),
  },
  {
    key: "workshop:777",
    source: "workshop",
    workshopId: "777",
    enabled: true,
    pack: pack({
      id: "shared-grid",
      title: "Shared Grid",
      creator: "Bo",
      version: "2",
    }),
  },
];

async function mockDesktop(page: Page, steamOnline: boolean, theme: string) {
  await page.addInitScript(
    ({ entries: initial, steamOnline, theme }) => {
      localStorage.clear();
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem("theme", theme);
      // A returning player reaches the New Game catalog instead of Mission 1.
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [{ scenarioId: 0, date: "2026-01-01", timesPlayed: 1 }],
        }),
      );
      const noop = () => () => {};
      const display = {
        fullscreen: false,
        width: 1280,
        height: 900,
        resolutions: [{ width: 1280, height: 900 }],
      };
      let entries: InstalledMod[] = initial;
      window.__mods = { requests: [], scores: 0 };
      // Behaves like the Electron bridge: requests resolve with readable errors, never reject.
      const mods = async (input: ModRequest): Promise<ModLibrary> => {
        window.__mods.requests.push(input);
        switch (input.kind) {
          case "enable":
            entries = entries.map((e) =>
              e.key === input.key ? { ...e, enabled: input.enabled } : e,
            );
            return { entries };
          case "remove":
            entries = entries.filter((e) => e.key !== input.key);
            return { entries, message: "Removed." };
          case "refresh":
            return steamOnline
              ? { entries, message: "Workshop mods are up to date." }
              : {
                  entries,
                  error: "Workshop needs Steam. Local mods still work offline.",
                };
          case "publish":
            await new Promise<void>((resolve) => {
              window.__mods.finishUpload = resolve;
            });
            entries = entries.map((e) =>
              e.key === input.key ? { ...e, workshopId: "456" } : e,
            );
            return {
              entries,
              message:
                "Uploaded, but hidden until you accept the Steam Workshop agreement.",
              published: { workshopId: "456", agreement: true },
            };
          default:
            return { entries };
        }
      };
      window.electrifyDesktop = {
        apiVersion: 1,
        mods,
        getState: async () => ({
          display,
          steam: {
            available: steamOnline,
            online: steamOnline,
            cloudEnabled: false,
          },
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
        submitScore: async () => {
          window.__mods.scores++;
        },
        openFriends: async () => {},
        // Matches the native bridge with Steam multiplayer unavailable.
        multiplayerRequest: async () => ({
          available: false,
          members: [],
          connected: [],
          error: "Connect to Steam to play with friends",
        }),
      };
    },
    { entries: ENTRIES, steamOnline, theme },
  );
}

/** Review captures only, written outside the repository when REVIEW_SCREENSHOT_DIR is set. */
async function screenshot(page: Page, name: string) {
  if (!process.env.REVIEW_SCREENSHOT_DIR) return;
  await fs.mkdir(process.env.REVIEW_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(process.env.REVIEW_SCREENSHOT_DIR, name),
    animations: "disabled",
  });
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function playAndCheckRun(page: Page, title: string) {
  await page
    .getByRole("button", { name: `Play ${title}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Play ${title}`);
  await expect(dialog).toContainText("Modded run · unranked · no achievements");
  await dialog.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Build", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  // The whole run says, in words, that it is modded and unranked.
  await expect(
    page.getByText("Modded · Unranked", { exact: true }),
  ).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
}

test("desktop mod management, Workshop publishing and a modded run", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await mockDesktop(page, true, "light");
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("3 installed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage mods", exact: true }).click();
  const screenRoot = page.locator(".modsScreen");
  await expect(screenRoot).toBeVisible();
  await expect(
    screenRoot.getByText("by Community author · v1.0.0 · Local file"),
  ).toHaveCount(2);
  await expect(screenRoot.getByText("by Bo · v2 · Workshop")).toBeVisible();
  await expect(
    screenRoot.getByText(
      "Made for a different game version. Ask Community author for an update.",
    ),
  ).toBeVisible();
  await expect(screenRoot.getByText(/rules-|Seed/)).toHaveCount(0);
  await expect(
    screenRoot.getByText(
      "Solar build time −90% · Efficiency rebates cost −20%",
    ),
  ).toBeVisible();
  // Opening with Steam running checks for finished downloads without a success banner.
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__mods.requests.filter((r) => r.kind === "refresh").length,
      ),
    )
    .toBe(1);
  await expect(screenRoot.getByRole("status")).toHaveCount(0);

  await screenRoot.getByRole("button", { name: "Browse Workshop" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__mods.requests.at(-1)))
    .toEqual({ kind: "browse" });

  // Publishing confirms first, then stays open while the upload runs.
  await screenRoot
    .getByRole("button", { name: "Publish Community Grid", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Publish “Community Grid” to Workshop?");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Publish publicly" }).click();
  await expect(
    dialog.getByRole("button", { name: "Uploading…" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.__mods.finishUpload?.());
  await expect(dialog).toHaveCount(0);
  await expect(
    screenRoot.getByText(
      "Uploaded, but hidden until you accept the Steam Workshop agreement.",
    ),
  ).toBeVisible();
  await screenRoot.getByRole("button", { name: "Open on Steam" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__mods.requests.at(-1)))
    .toEqual({ kind: "browse", workshopId: "456" });
  await expect(
    screenRoot.getByRole("button", {
      name: "Update Community Grid on Workshop",
    }),
  ).toBeVisible();

  // Removing confirms first and then keeps focus in the list.
  await screenRoot
    .getByRole("button", { name: "Remove Old Grid", exact: true })
    .click();
  await expect(dialog).toContainText("Remove “Old Grid”?");
  await expect(dialog).toContainText(
    "Existing saves keep working. Import the file again to reinstall.",
  );
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(screenRoot.getByText("Old Grid", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    screenRoot.getByRole("button", { name: "Play Shared Grid", exact: true }),
  ).toBeFocused();
  // Keyboard and controller navigation move between mod rows, then along a row.
  await page.keyboard.press("ArrowUp");
  await expect(
    screenRoot.getByRole("button", {
      name: "Play Community Grid",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(screenRoot.getByLabel("Community Grid enabled")).toBeFocused();
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(page, "mods-1280-light.png");

  await playAndCheckRun(page, "Community Grid");
  // The mod's run-local facility modifier reaches the Build catalog.
  await openPane(
    page.locator(".facilities"),
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  await page.locator(".button-buildFacility").click();
  await page.locator(".button-buildGenerator").click();
  const solar = page.locator(".buildOption").filter({ hasText: /^Solar/ });
  await expect(solar).toBeVisible();
  const months = Number(
    /Build time\s*(\d+)\s*mo/.exec((await solar.textContent()) || "")?.[1],
  );
  expect(months).toBeGreaterThan(0);
  // Unmodded solar takes more than two years to build here.
  expect(months).toBeLessThan(12);
  expect(await page.evaluate(() => window.__mods.scores)).toBe(0);
});

for (const layout of [
  { width: 390, height: 844, theme: "dark" },
  { width: 360, height: 780, theme: "light" },
  { width: 360, height: 780, theme: "dark" },
] as const) {
  test(`offline mod management from New Game at ${layout.width}px ${layout.theme}`, async ({
    page,
  }) => {
    await page.setViewportSize(layout);
    await page.emulateMedia({
      colorScheme: layout.theme,
      reducedMotion: "reduce",
    });
    await mockDesktop(page, false, layout.theme);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Start a new game", exact: true })
      .or(page.getByRole("button", { name: "Start playing", exact: true }))
      .click();
    await page.getByLabel("Open community scenarios").click();
    const screenRoot = page.locator(".modsScreen");
    await expect(
      screenRoot.getByText("Community Grid", { exact: true }),
    ).toBeVisible();
    // Workshop needs Steam; local mods still play offline.
    await expect(
      screenRoot.getByText(
        "Workshop needs Steam. Local mods still work offline.",
      ),
    ).toBeVisible();
    await expect(
      screenRoot.getByRole("button", { name: "Browse Workshop" }),
    ).toBeDisabled();
    await expect(
      screenRoot.getByText(
        "Connect to Steam to unsubscribe. You can disable it now.",
      ),
    ).toBeVisible();
    await expect(
      screenRoot.getByRole("button", { name: "Unsubscribe from Shared Grid" }),
    ).toHaveCount(0);
    // Disabled mods stay installed but leave the play list.
    const play = screenRoot.getByRole("button", {
      name: "Play Shared Grid",
      exact: true,
    });
    await expect(play).toBeVisible();
    await screenRoot.getByLabel("Shared Grid enabled").click();
    await expect(play).toHaveCount(0);
    await expect(
      screenRoot.getByText("by Bo · v2 · Workshop · Disabled"),
    ).toBeVisible();
    await screenRoot.getByLabel("Shared Grid enabled").click();
    await expect(play).toBeVisible();
    for (const button of await screenRoot.getByRole("button").all())
      if (await button.isVisible())
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(page, `mods-${layout.width}-${layout.theme}.png`);
    if (layout.width === 360 && layout.theme === "dark")
      await playAndCheckRun(page, "Community Grid");
    expect(await page.evaluate(() => window.__mods.scores)).toBe(0);
  });
}
