import { test, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { packageDigest, validateMod } from "../src/mods/ModSchema";
import { wToSliderTick } from "../src/helpers/BuildSizing";
import type { GameType } from "../src/Types";
import type { InstalledMod, ModLibrary, ModRequest } from "../src/mods/Types";
import { openPane } from "./layout";
import { verifyMenuKeyboard } from "./menu-keyboard";
import { readSavedGame } from "./save-fixture";
import type { DesktopInputFrame } from "../src/Desktop";

declare global {
  interface Window {
    __mods: {
      requests: ModRequest[];
      scores: number;
      finishUpload?: () => void;
      forecasts?: {
        loads: GameType["loadAdditions"];
        responses: { key: string; optionId?: string }[];
      }[];
      forecastReplies?: number;
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
  description: "A community grid with its own planning decisions.",

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

async function mockDesktop(
  page: Page,
  steamOnline: boolean,
  theme: string,
  entries = ENTRIES,
) {
  await page.addInitScript(
    ({ entries: initial, steamOnline, theme }) => {
      localStorage.clear();
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem("musicVolume", "0.5");
      localStorage.setItem("soundEffectsVolume", "0.5");
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
          case "template":
            return {
              entries,
              message: "Template saved. Edit it, then choose Import mod.",
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
    { entries, steamOnline, theme },
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

/** Keep the evidence clear of a fractional scroll edge without changing its layout. */
async function scrollEvidenceIntoView(label: Locator) {
  await label.scrollIntoViewIfNeeded();
  await label.evaluate((element) => {
    let scroller = element.closest<HTMLElement>(".MuiDialogContent-root");
    if (!scroller)
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (
          parent.scrollHeight > parent.clientHeight &&
          /auto|scroll/.test(getComputedStyle(parent).overflowY)
        ) {
          scroller = parent;
          break;
        }
      }
    if (scroller)
      scroller.scrollTop +=
        element.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        8;
  });
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

// Advance the actual animation-frame clock in bounded catch-up steps. All simulation
// state still comes from the live reducer; this is functional QA, not a speed benchmark.
async function advanceExampleTo(page: Page, reached: Locator) {
  for (let step = 0; step < 220; step++) {
    if (await reached.isVisible()) return;
    await page.clock.fastForward(1000);
  }
  await expect(
    reached,
    "the real example reaches its next boundary",
  ).toBeVisible();
}

async function observeExampleForecasts(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (event.data.transport)
            window.__mods.forecastReplies =
              (window.__mods.forecastReplies ?? 0) + 1;
        });
      }
      postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        if (
          message &&
          typeof message === "object" &&
          "game" in message &&
          "now" in message
        ) {
          const game = message.game as GameType;
          (window.__mods.forecasts ??= []).push({
            loads: game.loadAdditions.map((load) => ({ ...load })),
            responses: game.worldEvents.occurrences
              .filter((event) => typeof event.attributes.choice === "string")
              .map((event) => ({
                key: event.key,
                optionId: String(event.attributes.choice),
              })),
          });
        }
        // Observe the public worker boundary without intercepting or editing the request.
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
}

// Each outcome runs in one theme.
for (const [theme, winning] of [
  ["dark", true],
  ["light", false],
] as const) {
  test(`finished connection example reaches ${winning ? "success" : "failure"} in ${theme}`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    page.setDefaultTimeout(20000);
    const example = validateMod(
      JSON.parse(
        await fs.readFile(
          path.resolve("docs/mods/examples/funded-or-phased-connection.json"),
          "utf8",
        ),
      ),
    );
    const entry: InstalledMod = {
      key: `local:${example.id}`,
      source: "local",
      enabled: true,
      pack: example,
    };
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await mockDesktop(page, false, theme, [entry]);
    await observeExampleForecasts(page);
    await page.clock.install();
    await page.goto("/");
    await page.getByRole("button", { name: "Mods", exact: true }).click();
    const play = page.getByRole("button", {
      name: `Play ${example.title}`,
      exact: true,
    });
    await expect(play).toBeEnabled({ timeout: 60000 });
    await play.focus();
    await page.keyboard.press("Enter");
    const launch = page.getByRole("dialog");
    const easy = launch.getByRole("button", { name: "Easy", exact: true });
    await easy.focus();
    await page.keyboard.press("Enter");
    await expect(easy).toHaveAttribute("aria-pressed", "true");
    await expect(launch).toContainText("Serve the connected city");
    await expect(launch).toContainText("Retain your starting customers");
    await expect(launch).toContainText(
      "Modded run · unranked · no achievements",
    );
    expect(await noHorizontalScroll(page)).toBe(true);
    await launch.getByRole("button", { name: "Start", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Build", exact: true }),
    ).toBeVisible({ timeout: 60000 });
    const appbar = page.locator("#appbar:visible");
    await appbar.getByRole("button", { name: "pause", exact: true }).click();
    await openPane(
      page.getByRole("region", { name: "Programs", exact: true }),
      page.getByRole("button", { name: "Programs", exact: true }),
    );
    const rate = page.getByRole("slider", {
      name: "The rate you charge for electricity generation",
      exact: true,
    });
    await rate.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(rate).toHaveAttribute("aria-valuenow", "0.12");
    await page.keyboard.press("Escape");
    if (winning) {
      await openPane(
        page.locator(".facilities"),
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
      await page.locator(".button-buildFacility").click();
      await page.locator(".button-buildGenerator").click();
      const capacity = page.getByRole("slider", { name: /^Capacity/ });
      await capacity.focus();
      await page.keyboard.press("Home");
      for (let tick = 0; tick < wToSliderTick(50e6); tick++)
        await page.keyboard.press("ArrowRight");
      await expect(page.locator("#construction-capacity")).toContainText(
        /50\s?MW/,
      );
      await page
        .getByRole("button", {
          name: "Review purchase of Natural Gas Peaker",
          exact: true,
        })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Take loan", exact: true })
        .click();
      // Committing the purchase returns to the fleet at every viewport.
      await expect(
        page.getByRole("region", { name: "Build", exact: true }),
      ).toHaveCount(0);
      const opening = (await readSavedGame(page))!;
      expect(opening.facilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Natural Gas Peaker",
            peakW: 50e6,
          }),
        ]),
      );
      expect(opening.dollarsPerkWh).toBe(0.12);
    }
    await appbar
      .getByRole("button", { name: "fast speed", exact: true })
      .click();
    const choice = page.getByRole("dialog", {
      name: /Negotiate the data-center connection/,
    });
    await advanceExampleTo(page, choice);
    const pending = (await readSavedGame(page))!;
    expect(pending.date.monthsElapsed).toBe(48);
    expect(pending.speed).toBe("PAUSED");
    await page.keyboard.press("Escape");
    await expect(choice).toBeVisible();
    const response = choice.getByRole("button", {
      name: winning ? "Require phased connections" : "Accept funded connection",
      exact: true,
    });
    for (const button of await choice.getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    const repliesBefore = await page.evaluate(
      () => window.__mods.forecastReplies ?? 0,
    );
    await response.focus();
    await expect(
      page.locator("iframe#webpack-dev-server-client-overlay"),
    ).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (winning && theme === "dark" && page.viewportSize()!.width === 360)
      await screenshot(page, "finished-connection-choice-360-dark.png");
    await page.keyboard.press("Enter");
    await expect(choice).toHaveCount(0);
    const key = `mod:${example.id}:arc:106:choice:connection`;
    const committed = (await readSavedGame(page))!;
    expect(
      committed.worldEvents.occurrences.filter((event) => event.key === key),
    ).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({
          choice: winning ? "phased" : "fast-track",
        }),
      }),
    ]);
    expect(
      committed.loadAdditions.map((load) => ({
        peakW: load.peakW,
        year: load.startsYear,
      })),
    ).toEqual(
      winning
        ? [
            { peakW: 50e6, year: 2026 },
            { peakW: 50e6, year: 2028 },
          ]
        : [{ peakW: 100e6, year: 2026 }],
    );
    await openPane(
      page.locator(".insights"),
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    await expect
      .poll(async () =>
        page.evaluate(
          (key) =>
            window.__mods.forecasts?.some((forecast) =>
              forecast.responses.some((response) => response.key === key),
            ),
          key,
        ),
      )
      .toBe(true);
    await expect
      .poll(
        async () => page.evaluate(() => window.__mods.forecastReplies ?? 0),
        { timeout: 60000 },
      )
      .toBeGreaterThan(repliesBefore);
    const request = await page.evaluate(
      (key) =>
        window.__mods.forecasts!.findLast((forecast) =>
          forecast.responses.some((response) => response.key === key),
        ),
      key,
    );
    expect(request!.loads).toEqual(committed.loadAdditions);
    const chart = page
      .locator(".insights:visible")
      .getByRole("img", { name: /^(Chart of|Monthly ranges of)/ })
      .first();
    await expect(chart).toBeVisible({ timeout: 60000 });
    await expect(chart).toHaveAttribute("aria-label", /demand|supply/i);
    await page.keyboard.press("Escape");
    await appbar
      .getByRole("button", { name: "fast speed", exact: true })
      .click();
    if (winning) {
      await advanceExampleTo(
        page,
        appbar.getByRole("heading").filter({ hasText: "Feb 2026" }),
      );
      await appbar.getByRole("button", { name: "pause", exact: true }).click();
      const scenario = page.getByRole("region", {
        name: "Scenario",
        exact: true,
      });
      await openPane(
        scenario,
        page.getByRole("button", { name: "Scenario", exact: true }),
      );
      await expect(
        scenario.getByRole("region", { name: "Victory conditions" }),
      ).toContainText("1/36 months completed");
      expect(
        (await readSavedGame(page))!.objectiveProgress?.completedMonths,
      ).toBe(73);
      await page.keyboard.press("Escape");
      await appbar
        .getByRole("button", { name: "fast speed", exact: true })
        .click();
    }
    const result = page.getByRole("dialog", {
      name: winning
        ? "A bigger city, a bigger grid"
        : "Mission objective missed",
      exact: true,
    });
    await advanceExampleTo(page, result);
    const evidence = result.getByRole("region", {
      name: "Objective results",
    });
    await expect(evidence).toContainText(
      `Serve the connected city · Required · ${winning ? "Met" : "Failed"}`,
    );
    await expect(evidence).toContainText("Months 73–108");
    await expect(evidence).toContainText(
      winning ? "36/36 months completed" : "1/36 months completed",
    );
    if (!winning)
      await expect(evidence).toContainText(
        "At least one completed month supplied less than the required share of customer demand.",
      );
    await expect(result).toContainText(
      "Modded run · not ranked and no achievements.",
    );
    expect(await page.evaluate(() => window.__mods.scores)).toBe(0);
    await expect(
      page.locator("iframe#webpack-dev-server-client-overlay"),
    ).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    const goal = evidence
      .getByText("Serve the connected city", { exact: false })
      .first();
    await scrollEvidenceIntoView(goal);
    await expect(goal).toBeInViewport({ ratio: 1 });
    // The evidence scrolls inside the dialog while its action footer stays usable.
    const nextGame = result.getByRole("button", {
      name: "New game",
      exact: true,
    });
    await expect(nextGame).toBeInViewport({ ratio: 1 });
    const footerBounds = (await nextGame.boundingBox())!;
    expect(footerBounds.height).toBeGreaterThanOrEqual(
      page.viewportSize()!.width < 600 ? 44 : 40,
    );
    expect(footerBounds.x).toBeGreaterThanOrEqual(0);
    expect(footerBounds.x + footerBounds.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    // Let ordinary shortage notices finish after the stopped outcome, so they
    // cannot cover the debrief or its footer in a review capture.
    const toast = page.locator(".snackbarContent");
    for (let notice = 0; notice < 3 && (await toast.isVisible()); notice++)
      await page.clock.fastForward(10000);
    await expect(toast).toBeHidden();
    // Failed runs retain results instead of a resumable game payload; observe
    // the stopped live clock and canonical completed-month evidence above.
    await expect(appbar.locator('button[aria-label="pause"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(appbar).toContainText(winning ? "Jan 2029" : "Feb 2026");
    if (winning && page.viewportSize()!.width === 1280) {
      // The flow above is checked at 1280×800. A taller normal desktop capture
      // fits the complete intro and results without a clipped scroll seam.
      await page.setViewportSize({ width: 1280, height: 900 });
      await result.locator(".MuiDialogContent-root").evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect(goal).toBeInViewport({ ratio: 1 });
      await expect(nextGame).toBeInViewport({ ratio: 1 });
    }
    await expect(
      page.locator("iframe#webpack-dev-server-client-overlay"),
    ).toHaveCount(0);
    await screenshot(
      page,
      `finished-connection-${winning ? "success" : "failure"}-${page.viewportSize()!.width}-${theme}.png`,
    );
  });
}

test("desktop menu keyboard navigation includes Mods between Manual and Settings", async ({
  page,
}) => {
  await mockDesktop(page, false, "system");
  await page.goto("/");
  // Use the first-time-player journey, just like the packaged desktop fixture.
  await page.evaluate(() => localStorage.removeItem("plays"));
  await verifyMenuKeyboard(page);
});

async function dismissToast(page: Page) {
  const toast = page.locator(".snackbarContent");
  await expect(toast).toBeVisible();
  const box = (await toast.boundingBox())!;
  // Compact layouts dismiss toasts by swiping rather than showing a close button.
  await page.mouse.move(box.x + 24, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 184, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(toast).toBeHidden();
}

async function playAndCheckRun(
  page: Page,
  title: string,
  initialChoice?: string,
) {
  await page
    .getByRole("button", { name: `Play ${title}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Play ${title}`);
  await expect(dialog).toContainText("Modded run · unranked · no achievements");
  await dialog.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    initialChoice
      ? page.getByRole("dialog", { name: new RegExp(initialChoice) })
      : page.getByRole("button", { name: "Build", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  // The whole run says, in words, that it is modded and unranked.
  await expect(
    page.getByText("Modded · Unranked", { exact: true }),
  ).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
}

test("cold share-load preparation stays isolated when another mod starts", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const shareEntry = (id: string, baseScenarioId: number): InstalledMod => ({
    key: `local:${id}`,
    source: "local",
    enabled: true,
    pack: pack({
      id,
      title: id,
      baseScenarioId,
      officialArcs: [],
      scenario: { durationMonths: 24 },
      events: [
        {
          id: "arrival",
          title: "Campus arrival",
          message: "The campus connects.",
          preview: "The campus will connect.",
          startMonth: 6,
          loads: [
            {
              id: "campus",
              startMonth: 6,
              peakShareOfStartingPeak: 0.1,
              demandType: "Data Centers",
              loadFactor: 0.8,
            },
          ],
        },
      ],
    }),
  });
  const entries = [
    shareEntry("ready-grid", 999),
    shareEntry("waiting-grid", 103),
  ];
  let releaseWeather!: () => void;
  const weatherReleased = new Promise<void>((resolve) => {
    releaseWeather = resolve;
  });
  let weatherPending = false;
  await context.route("**/data/weather/PIT.bin", async (route) => {
    weatherPending = true;
    await weatherReleased;
    await route.continue();
  });
  const workers: import("@playwright/test").Worker[] = [];
  page.on("worker", (worker) => workers.push(worker));
  await mockDesktop(page, false, "light", entries);
  await page.goto("/");
  try {
    await page.getByRole("button", { name: "Mods", exact: true }).click();
    const mods = page.locator(".modsScreen");
    await expect(mods.getByText("Preparing scenario…").first()).toBeVisible();
    await expect(
      mods.getByRole("button", { name: "Play ready-grid" }),
    ).toBeVisible({ timeout: 60000 });
    await expect.poll(() => weatherPending).toBe(true);
    await expect.poll(() => workers.length).toBe(2);
    await expect(
      mods.getByRole("button", { name: "Play waiting-grid" }),
    ).toHaveCount(0);
    await expect(
      page.locator("iframe#webpack-dev-server-client-overlay"),
    ).toHaveCount(0);
    await screenshot(
      page,
      `mods-preparing-${page.viewportSize()!.width}-light.png`,
    );
    await playAndCheckRun(page, "ready-grid");
    await expect(
      page.locator("iframe#webpack-dev-server-client-overlay"),
    ).toHaveCount(0);
    const pause = page
      .getByRole("button", { name: "pause", exact: true })
      .first();
    if ((await pause.getAttribute("aria-pressed")) !== "true")
      await pause.click();
    const before = (await readSavedGame(page))!;
    expect(before.customScenario!.mod!.rules.startingPeakW).toBeGreaterThan(0);
    const weather = before.timeline.map(
      ({
        minute,
        temperatureC,
        windKph,
        solarIrradianceWM2,
        precipitationMm,
      }) => ({
        minute,
        temperatureC,
        windKph,
        solarIrradianceWM2,
        precipitationMm,
      }),
    );
    expect(weather.some((tick) => tick.temperatureC !== 0)).toBe(true);
    const finished = new Promise<void>((resolve) =>
      workers[1].on("close", () => resolve()),
    );
    releaseWeather();
    await finished;
    const programs = page.getByRole("region", {
      name: "Programs",
      exact: true,
    });
    await openPane(
      programs,
      page.getByRole("button", { name: "Programs", exact: true }),
    );
    const rate = programs.getByRole("slider", {
      name: "The rate you charge for electricity generation",
    });
    await rate.press("ArrowRight");
    const after = (await readSavedGame(page))!;
    expect(after.date.minute).toBe(before.date.minute);
    expect(after.location.id).toBe(before.location.id);
    expect(
      after.timeline.map(
        ({
          minute,
          temperatureC,
          windKph,
          solarIrradianceWM2,
          precipitationMm,
        }) => ({
          minute,
          temperatureC,
          windKph,
          solarIrradianceWM2,
          precipitationMm,
        }),
      ),
    ).toEqual(weather);
  } finally {
    releaseWeather();
  }
});

test("a mod choice blocks, explains funding and updates the saved forecast", async ({
  page,
}) => {
  const theme = "light" as const;
  test.setTimeout(120000);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  const entry: InstalledMod = {
    key: "local:choice-grid",
    source: "local",
    enabled: true,
    pack: pack({
      id: "choice-grid",
      title: "Choice Grid",
      officialArcs: [],
      objectives: [],
      scenario: {
        durationMonths: 6,
        cash: 1000000000,
        startingCustomers: 10000,
        dollarsPerkWh: 0.2,
      },
      choices: [
        {
          id: "grid-bond",
          dueMonth: 1,
          title: "Grid investment",
          prompt: "Choose support before the new demand connects.",
          options: [
            {
              id: "expensive",
              label: "Fund every upgrade",
              description: "Commit the full upgrade budget.",
              message: "Upgrades funded.",
              costDollars: 2000000000,
            },
            {
              id: "funded",
              label: "Accept support",
              description: "Accept support and connect the new demand now.",
              message: "Support accepted.",
              grantDollars: 50000,
            },
            {
              id: "standard",
              label: "Keep the current plan",
              description: "Keep the existing demand forecast without support.",
              message: "Current plan kept.",
              costDollars: 0,
            },
          ],
        },
        {
          id: "later-review",
          dueMonth: 1,
          title: "Operating plan",
          prompt: "Choose the plan to use after this investment.",
          options: Array.from({ length: 8 }, (_, index) => ({
            id: `response-${index + 1}`,
            label: `Operating plan ${index + 1}`,
            description: `Keep the committed investment with operating plan ${index + 1}.`,
            message: `Operating plan ${index + 1} selected.`,
            costDollars: 0,
          })),
        },
      ],
      events: [
        {
          id: "new-demand",
          title: "New demand connects",
          message: "The funded connection increases demand.",
          preview: "The funded connection will increase demand.",
          startMonth: 1,
          durationMonths: 2,
          requiresChoice: { choiceId: "grid-bond", optionIds: ["funded"] },
          effects: { demandMultiplier: 1.5 },
        },
      ],
    }),
  };
  await mockDesktop(page, false, theme, [entry]);
  await page.goto("/");
  await page.getByRole("button", { name: "Mods", exact: true }).click();
  await playAndCheckRun(page, "Choice Grid", "Grid investment");
  let dialog = page.getByRole("dialog", { name: /Grid investment/ });
  await expect(dialog).toBeVisible();
  await expect(
    page.locator("iframe#webpack-dev-server-client-overlay"),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Fund every upgrade ($2B)" }),
  ).toBeDisabled();
  await expect(dialog.getByText(/Insufficient cash/)).toBeVisible();
  await expect(
    dialog.getByText("One-time grant: $50k", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Accept support", exact: true }),
  ).toBeFocused();
  for (const button of await dialog.getByRole("button").all()) {
    const bounds = (await button.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
  }
  const before = (await readSavedGame(page))!;
  expect(before.date.minute).toBe(0);
  expect(before.speed).toBe("PAUSED");
  expect(
    before.worldEvents.occurrences.filter(
      (event) => event.key === "mod:choice-grid:grid-bond",
    ),
  ).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await screenshot(
    page,
    `mod-choice-${page.viewportSize()!.width}-${theme}.png`,
  );
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  dialog = page.getByRole("dialog", { name: /Grid investment/ });
  await expect(
    dialog.getByRole("button", { name: "Accept support", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const next = page.getByRole("dialog", { name: /Operating plan/ });
  await expect(next).toBeVisible();
  await expect(next.getByRole("button")).toHaveCount(8);
  await expect(
    next.getByRole("button", { name: "Operating plan 1", exact: true }),
  ).toBeFocused();
  const committed = (await readSavedGame(page))!;
  expect(committed.date.minute).toBe(before.date.minute);
  expect(committed.speed).toBe("PAUSED");
  expect(committed.timeline[0].cash - before.timeline[0].cash).toBe(50000);
  expect(committed.timeline[0].demandW).toBeGreaterThan(
    before.timeline[0].demandW * 1.4,
  );
  expect(
    committed.worldEvents.occurrences.filter(
      (event) => event.key === "mod:choice-grid:grid-bond",
    ),
  ).toHaveLength(1);
  for (let index = 0; index < 7; index++) await page.keyboard.press("Tab");
  const last = next.getByRole("button", {
    name: "Operating plan 8",
    exact: true,
  });
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  const lastDescription = next.getByText(
    "Keep the committed investment with operating plan 8.",
    { exact: true },
  );
  await lastDescription.scrollIntoViewIfNeeded();
  await expect(lastDescription).toBeInViewport();
  await expect(last).toBeFocused();
  expect(await noHorizontalScroll(page)).toBe(true);
  await expect(
    page.locator("iframe#webpack-dev-server-client-overlay"),
  ).toHaveCount(0);
  await screenshot(
    page,
    `mod-eight-options-${page.viewportSize()!.width}-${theme}.png`,
  );
  await page.keyboard.press("Enter");
  await expect(
    page.locator("[data-scenario-choice]"),
    "all simultaneous decisions are answered",
  ).toHaveCount(0);
  const answered = (await readSavedGame(page))!;
  expect(answered.speed).toBe("PAUSED");
  expect(answered.timeline[0].cash).toBe(committed.timeline[0].cash);
  expect(
    answered.worldEvents.occurrences.filter(
      (event) => event.key === "mod:choice-grid:grid-bond",
    ),
  ).toHaveLength(1);
  expect(
    answered.worldEvents.occurrences.filter(
      (event) => event.key === "mod:choice-grid:later-review",
    ),
  ).toHaveLength(1);
  const programs = page.getByRole("region", {
    name: "Programs",
    exact: true,
  });
  await openPane(
    programs,
    page.getByRole("button", { name: "Programs", exact: true }),
  );
  await programs
    .getByRole("slider", {
      name: "The rate you charge for electricity generation",
    })
    .press("ArrowRight");
  const reforecast = (await readSavedGame(page))!;
  expect(reforecast.date.minute).toBe(0);
  expect(
    reforecast.timeline.reduce(
      (sum, tick) => sum + (tick.revenueGrants ?? 0),
      0,
    ),
  ).toBe(50000);
  expect(
    reforecast.worldEvents.occurrences.filter(
      (event) => event.key === "mod:choice-grid:grid-bond",
    ),
  ).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Build", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.locator("[data-scenario-choice]")).toHaveCount(0);
  await expect(
    page.locator("iframe#webpack-dev-server-client-overlay"),
  ).toHaveCount(0);
  const resumed = (await readSavedGame(page))!;
  expect(
    resumed.worldEvents.occurrences.filter(
      (event) => event.key === "mod:choice-grid:grid-bond",
    ),
  ).toHaveLength(1);
  expect(
    resumed.timeline.reduce((sum, tick) => sum + (tick.revenueGrants ?? 0), 0),
  ).toBe(50000);
  expect(resumed.speed).toBe("PAUSED");
});

for (const [theme, requiredBills] of [
  ["light", false],
  ["dark", true],
] as const) {
  test(`mod objective evidence ${requiredBills ? "required failure" : "optional failure and success"} in ${theme}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    const entry: InstalledMod = {
      key: "local:objective-grid",
      source: "local",
      enabled: true,
      pack: pack({
        id: "objective-grid",
        title: "Objective Grid",
        officialArcs: [],
        scenario: {
          durationMonths: 6,
          cash: 1000000000,
          startingCustomers: 10000,
          dollarsPerkWh: 0.2,
        },
        objectives: [
          {
            id: "supply",
            label: "Keep demand supplied",
            metric: "monthlyReliability",
            fromMonth: 1,
            throughMonth: 2,
            minDemandServedShare: 0,
          },
          {
            id: "bills",
            label: "Keep bills affordable",
            metric: "monthlyBilledRate",
            fromMonth: 1,
            throughMonth: 2,
            maxDollarsPerKWh: 0,
            required: requiredBills,
          },
        ],
      }),
    };
    await mockDesktop(page, false, theme, [entry]);
    await page.goto("/");
    await page.getByRole("button", { name: "Mods", exact: true }).click();
    await playAndCheckRun(page, "Objective Grid");
    const appbar = page.locator("#appbar:visible").first();
    await appbar.getByRole("button", { name: "pause", exact: true }).click();
    const panel = page.getByRole("region", { name: "Scenario", exact: true });
    const scenarioButton = page.getByRole("button", {
      name: "Scenario",
      exact: true,
    });
    await openPane(panel, scenarioButton);
    const rules = panel.getByRole("region", { name: "Victory conditions" });
    await expect(
      rules.getByText("Keep bills affordable", { exact: true }),
    ).toBeVisible();
    await expect(rules).toContainText(
      "Billed customer revenue per delivered kWh each month, excluding grants and exports.",
    );
    await expect(rules).toContainText(
      "Bills ≤$0/kWh each month · Jan–Feb 2020",
    );
    await expect(
      rules.getByText("0/2 months completed", { exact: true }),
    ).toHaveCount(2);
    await expect(rules.getByText("Optional", { exact: true })).toHaveCount(
      requiredBills ? 0 : 1,
    );
    await expect(
      page.locator("iframe#webpack-dev-server-client-overlay"),
    ).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(scenarioButton).toBeFocused();
    await appbar
      .getByRole("button", { name: "fast speed", exact: true })
      .click();
    if (!requiredBills) {
      await expect(appbar).toContainText("Feb 2020", { timeout: 30000 });
      await appbar.getByRole("button", { name: "pause", exact: true }).click();
      await openPane(panel, scenarioButton);
      await expect(rules).toContainText("1/2 months completed");
      await expect(rules).toContainText(
        "At least one completed month billed more than the starting-year rate ceiling.",
      );
      await expect(rules.getByText("Optional", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("dialog", { name: /Mission objective missed/ }),
      ).toHaveCount(0);
      const saved = (await readSavedGame(page))!;
      expect(saved.date.monthsElapsed).toBe(1);
      expect(saved.objectiveProgress?.completedMonths).toBe(1);
      const toast = page.locator(".snackbarContent");
      if (await toast.isVisible()) await dismissToast(page);
      const goal = rules.getByText("Keep bills affordable", { exact: true });
      await scrollEvidenceIntoView(goal);
      await expect(goal).toBeInViewport({ ratio: 1 });
      await expect(
        rules.getByText(
          "At least one completed month billed more than the starting-year rate ceiling.",
          { exact: true },
        ),
      ).toBeInViewport({ ratio: 1 });
      await screenshot(
        page,
        `mod-objective-progress-${page.viewportSize()!.width}-${theme}.png`,
      );
      await page.keyboard.press("Escape");
      await appbar
        .getByRole("button", { name: "fast speed", exact: true })
        .click();
    }
    const result = page.getByRole("dialog", {
      name: requiredBills ? "Mission objective missed" : "Mission complete",
      exact: true,
    });
    await expect(result).toBeVisible({ timeout: 60000 });
    const evidence = result.getByRole("region", {
      name: "Objective results",
    });
    await expect(evidence).toContainText(
      `Keep bills affordable · ${requiredBills ? "Required" : "Optional"} · Failed`,
    );
    await expect(evidence).toContainText(
      "Billed customer revenue per delivered kWh each month, excluding grants and exports.",
    );
    await expect(evidence).toContainText("Months 1–2");
    await expect(evidence).toContainText(
      "At least one completed month billed more than the starting-year rate ceiling.",
    );
    await expect(evidence).toContainText(
      requiredBills ? "1/2 months completed" : "2/2 months completed",
    );
    await expect(result).toContainText(
      "Modded run · not ranked and no achievements.",
    );
    expect(await page.evaluate(() => window.__mods.scores)).toBe(0);
    const toast = page.locator(".snackbarContent");
    if (await toast.isVisible()) await dismissToast(page);
    const goal = evidence
      .getByText("Keep bills affordable", { exact: false })
      .first();
    await scrollEvidenceIntoView(goal);
    await expect(goal).toBeInViewport({ ratio: 1 });
    await expect(
      evidence.getByText(
        "At least one completed month billed more than the starting-year rate ceiling.",
        { exact: true },
      ),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      page.locator("iframe#webpack-dev-server-client-overlay"),
    ).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    await screenshot(
      page,
      `mod-objective-${requiredBills ? "failure" : "success"}-${page.viewportSize()!.width}-${theme}.png`,
    );
  });
}

test("desktop mod management, Workshop publishing and a modded run", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await mockDesktop(page, true, "light");
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Mods", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Quit", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Mods", exact: true }).click();
  const screenRoot = page.locator(".modsScreen");
  await expect(screenRoot).toBeVisible();
  await expect(
    screenRoot.getByText("by Community author · v1.0.0 · Local file"),
  ).toHaveCount(2);
  await expect(screenRoot.getByText("by Bo · v2 · Workshop")).toBeVisible();
  await expect(
    screenRoot.getByText(
      "gameApi must be 1. This package targets an unsupported game contract.",
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
  expect(
    await page.evaluate(() =>
      window.__mods.requests.find((r) => r.kind === "publish"),
    ),
  ).toEqual(
    expect.objectContaining({
      kind: "publish",
      key: "local:community-grid",
      packageDigest: packageDigest(ENTRIES[0].pack),
      rulesDescription: expect.stringContaining("Rules"),
    }),
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await screenRoot.getByRole("button", { name: "Browse Workshop" }).click();
  await expect(
    screenRoot.getByRole("button", {
      name: "Publish Community Grid",
      exact: true,
    }),
  ).toBeDisabled();
  await page.evaluate(() => window.__mods.finishUpload?.());
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .locator(".snackbarContent")
      .getByText(
        "Uploaded, but hidden until you accept the Steam Workshop agreement.",
      ),
  ).toBeVisible();
  await page
    .locator(".snackbarContent")
    .getByRole("button", { name: "Open on Steam" })
    .click();
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
  await expect(
    screenRoot.getByRole("button", {
      name: "Author validation report for Community Grid",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(screenRoot.getByLabel("Community Grid enabled")).toBeFocused();
  const focusedRow = screenRoot
    .locator(".settingsKeyboardRow")
    .filter({ has: page.getByLabel("Community Grid enabled") });
  await expect(focusedRow).toHaveCSS("box-shadow", "none");
  await expect(focusedRow).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await dismissToast(page);
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

test("empty mod library offers Workshop first and template results in the shared toast", async ({
  page,
}) => {
  await mockDesktop(page, true, "dark", []);
  await page.goto("/");
  const mods = page.getByRole("button", { name: "Mods", exact: true });
  await expect(mods).toHaveClass(/MuiButton-text/);
  await mods.click();
  const installed = page.getByRole("region", { name: "Installed Mods" });
  await expect(
    installed.getByText("Install your first mod below"),
  ).toBeVisible();
  const buttons = installed.getByRole("button");
  await expect(buttons).toHaveText([
    "Browse Workshop",
    "Import mod",
    "Check for updates",
  ]);
  await expect(buttons.first()).toHaveClass(/MuiButton-contained/);
  await expect(page.getByText("Add by Workshop item ID")).toHaveCount(0);
  const guide = page.getByRole("link", { name: "Read the modding guide" });
  await expect(guide).toHaveAttribute(
    "href",
    "https://github.com/toddmedema/electrify#modding",
  );
  await page.getByRole("button", { name: "Save authoring template" }).click();
  const message = "Template saved. Edit it, then choose Import mod.";
  const toast = page.locator(".snackbarContent");
  await expect(toast).toContainText(message);
  await expect(page.locator(".modsScreen").getByText(message)).toHaveCount(0);
  await screenshot(page, `mods-empty-${page.viewportSize()!.width}-dark.png`);
  await dismissToast(page);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(mods).toBeFocused();
});

test("an empty library finishes its first Workshop subscription on overlay return", async ({
  page,
}) => {
  const theme = "light" as const;
  await mockDesktop(page, true, theme, []);
  await page.goto("/");
  await page.getByRole("button", { name: "Mods", exact: true }).click();
  const root = page.locator(".modsScreen");
  await expect(root.getByText("Install your first mod below")).toBeVisible();
  await expect(
    root.getByRole("button", { name: "Check for updates" }),
  ).toBeEnabled();
  await root.getByRole("button", { name: "Browse Workshop" }).click();
  await page.evaluate((installed) => {
    const bridge = window.electrifyDesktop!;
    const previous = bridge.mods!;
    let checks = 0;
    bridge.mods = async (input) => {
      if (input.kind !== "refresh") return previous(input);
      window.__mods.requests.push(input);
      checks++;
      return checks === 1
        ? { entries: [], downloads: [{ id: "777", status: "queued" }] }
        : { entries: [installed], downloads: [] };
    };
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  }, ENTRIES[2]);
  await expect(root.getByText("Workshop item 777: Queued")).toBeVisible();
  await expect(root.getByText("Shared Grid", { exact: true })).toBeVisible();
  await expect(root.getByText("Workshop item 777: Queued")).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("library recovery remains actionable after its toast is dismissed", async ({
  page,
}) => {
  const theme = "light" as const;
  await mockDesktop(page, false, theme, []);
  await page.addInitScript(() => {
    const previous = window.electrifyDesktop!.mods!;
    let broken = true;
    window.electrifyDesktop!.mods = async (input) => {
      if (input.kind === "reset") {
        window.__mods.requests.push(input);
        broken = false;
        return { entries: [], message: "Mod library reset." };
      }
      if (input.kind === "list" && broken) {
        window.__mods.requests.push(input);
        return {
          entries: [],
          unreadable: true,
          error:
            "Your mod library couldn't be read. Reset it to start over; the old files are kept.",
        };
      }
      return previous(input);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Mods", exact: true }).click();
  const root = page.locator(".modsScreen");
  await expect(
    root.getByRole("button", { name: "Reset mod library" }),
  ).toBeVisible();
  await dismissToast(page);
  await root.getByRole("button", { name: "Reset mod library" }).click();
  await expect(
    root.getByRole("button", { name: "Reset mod library" }),
  ).toHaveCount(0);
  await expect(root.getByText("Install your first mod below")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("mod details distinguish player rules from the complete author report", async ({
  page,
}) => {
  const theme = "light" as const;
  const entry: InstalledMod = {
    key: "local:read-the-rules",
    source: "local",
    enabled: true,
    pack: pack({
      id: "read-the-rules",
      title: "Connection Planning",
      description:
        "Prepare your grid before deciding how to connect a new campus.",
      officialArcs: [],
      scenario: {
        durationMonths: 6,
        startingYear: 2020,
        startingCustomers: 10000,
        cash: 1e9,
      },
      facilities: { Solar: { buildCost: 0.8 } },
      objectives: [
        {
          id: "serve-demand",
          label: "Keep your grid reliable",
          metric: "monthlyReliability",
          fromMonth: 1,
          throughMonth: 6,
          minDemandServedShare: 0.9,
        },
      ],
      choices: [
        {
          id: "connection",
          title: "Campus connection plan",
          prompt: "Choose a plan for your grid.",
          dueMonth: 2,
          options: [
            {
              id: "accept",
              label: "Accept connection",
              description: "Receive funding and connect the campus.",
              message: "Your grid accepted the connection.",
              grantDollars: 1e6,
            },
            {
              id: "decline",
              label: "Keep the current plan",
              description: "Continue without the new campus.",
              message: "Your grid kept its current plan.",
              costDollars: 0,
            },
          ],
        },
      ],
      events: [
        {
          id: "campus",
          title: "Campus connection",
          message: "The campus connects.",
          preview: "The campus will connect after your grid accepts.",
          startMonth: 2,
          requiresChoice: { choiceId: "connection", optionIds: ["accept"] },
          loads: [
            {
              id: "campus-load",
              startMonth: 2,
              peakMW: 1,
              loadFactor: 0.8,
              demandType: "Data Centers",
            },
          ],
        },
        {
          id: "private",
          title: "Private gas shortage",
          message: "Gas prices rise unexpectedly.",
          startMonth: 4,
          durationMonths: {
            byDifficulty: {
              Intern: 1,
              Employee: 1,
              Manager: 1,
              VP: 2,
              CEO: 2,
            },
          },
          visibility: "surprise",
          effects: {
            fuelPriceMultipliers: {
              "Natural Gas": {
                byDifficulty: {
                  Intern: 1,
                  Employee: 1.2,
                  Manager: 1.25,
                  VP: 1.3,
                  CEO: 1.4,
                },
              },
            },
          },
        },
      ],
    }),
  };
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await mockDesktop(page, false, theme, [entry]);
  await page.addInitScript(() => {
    let frame: DesktopInputFrame = {
      connected: false,
      actions: [],
      glyphs: {},
    };
    const bridge = window.electrifyDesktop!;
    bridge.setInputContext = async () => ({ ...frame, actions: [] });
    bridge.onInput = (listener) => {
      const receive = (event: Event) => {
        frame = (event as CustomEvent<DesktopInputFrame>).detail;
        listener(frame);
      };
      window.addEventListener("modDetailsInput", receive);
      return () => window.removeEventListener("modDetailsInput", receive);
    };
  });
  const input = async (action: "down" | "confirm" | "back") => {
    await page.evaluate(
      (action) =>
        window.dispatchEvent(
          new CustomEvent("modDetailsInput", {
            detail: {
              connected: true,
              actions: [action],
              glyphs: {
                down: { label: "D-pad down" },
                confirm: { label: "A" },
                back: { label: "B" },
              },
            },
          }),
        ),
      action,
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  };
  const controllerSelect = async (control: Locator) => {
    for (let index = 0; index < 30; index++) {
      if (
        await control.evaluate((element) => element === document.activeElement)
      )
        return;
      await input("down");
    }
    await expect(
      control,
      "details controls stay reachable with controller navigation",
    ).toBeFocused();
  };
  await page.goto("/");
  await page.getByRole("button", { name: "Mods", exact: true }).click();
  const play = page.getByRole("button", {
    name: "Play Connection Planning",
    exact: true,
  });
  await expect(play).toBeEnabled({ timeout: 60000 });
  await play.click();
  const details = page.getByRole("dialog", {
    name: "Play Connection Planning",
    exact: true,
  });
  await expect(
    details.getByRole("region", { name: "Author description" }),
  ).toContainText(entry.pack.description);
  await expect(
    details.getByRole("region", { name: "Resolved setup" }),
  ).toContainText("Starting peak demand");
  await expect(
    details.getByRole("region", { name: "Resolved setup" }),
  ).not.toContainText("Preparing baseline forecast");
  await expect(
    details.getByRole("region", { name: "Scenario objectives" }),
  ).toContainText("Keep your grid reliable");
  const timeline = details.getByRole("region", {
    name: "Announced timeline",
  });
  await expect(timeline).toContainText("Campus connection plan");
  await expect(timeline).toContainText("Feb 2020");
  await expect(timeline).toContainText("1 MW");
  await expect(timeline).not.toContainText("Private gas shortage");
  const fleet = details.getByRole("button", {
    name: "Starting fleet",
    exact: true,
  });
  await fleet.focus();
  await page.keyboard.press("Enter");
  await expect(
    details.getByRole("region", { name: "Starting fleet" }),
  ).toContainText("Starting-asset ID:");
  const modifier = details.getByRole("button", {
    name: "Static modifiers",
    exact: true,
  });
  await modifier.focus();
  await page.keyboard.press("Space");
  await expect(
    details.getByRole("region", { name: "Static modifiers" }),
  ).toContainText("0.8");
  for (const button of await details.getByRole("button").all())
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const bounds = (await details.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  expect(await noHorizontalScroll(page)).toBe(true);
  await expect(
    page.locator("iframe#webpack-dev-server-client-overlay"),
  ).toHaveCount(0);
  const goal = details.getByText("Keep your grid reliable", { exact: true });
  await scrollEvidenceIntoView(goal);
  await expect(goal).toBeInViewport({ ratio: 1 });
  await expect(
    details.getByRole("heading", {
      name: "Play Connection Planning",
      exact: true,
    }),
  ).toBeInViewport({ ratio: 1 });
  await screenshot(
    page,
    `mod-details-${page.viewportSize()!.width}-${theme}.png`,
  );
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  const author = page.getByRole("button", {
    name: "Author validation report for Connection Planning",
    exact: true,
  });
  await author.focus();
  await page.keyboard.press("Enter");
  const report = page.getByRole("dialog", {
    name: "Author validation report: Connection Planning",
    exact: true,
  });
  await expect(report).toContainText(
    "Validation passed. Includes hidden events.",
  );
  const reportDefault = report.getByRole("button", {
    name: "Easy",
    exact: true,
  });
  await expect(reportDefault).toHaveAttribute("aria-pressed", "true");
  await expect(reportDefault).toBeInViewport({ ratio: 1 });
  const reportPicker = report.getByRole("group", {
    name: "Difficulty",
    exact: true,
  });
  const pickerBounds = (await reportPicker.boundingBox())!;
  expect(pickerBounds.x).toBeGreaterThanOrEqual(0);
  expect(pickerBounds.x + pickerBounds.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  for (const button of await reportPicker.getByRole("button").all()) {
    const bounds = (await button.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(pickerBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(
      pickerBounds.x + pickerBounds.width,
    );
    const label = await button.evaluate((element) => {
      const text = Array.from(element.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      )!;
      const range = document.createRange();
      range.selectNodeContents(text);
      return {
        height: range.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      };
    });
    expect(label.height).toBeLessThanOrEqual(label.lineHeight + 1);
  }
  expect(await noHorizontalScroll(page)).toBe(true);
  await expect(
    report.getByRole("heading", {
      name: "Author validation report: Connection Planning",
      exact: true,
    }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    page.locator("iframe#webpack-dev-server-client-overlay"),
  ).toHaveCount(0);
  await screenshot(
    page,
    `mod-author-difficulty-${page.viewportSize()!.width}-${theme}.png`,
  );
  const complete = report.getByRole("button", {
    name: "Complete event and decision timeline",
    exact: true,
  });
  await complete.focus();
  await page.keyboard.press("Enter");
  const privateRule = report.getByText(/Month 4.*Private gas shortage/);
  const privateRow = privateRule.locator("..");
  await expect(privateRow).toContainText(
    "Natural Gas fuel price: 120% of normal",
  );
  await scrollEvidenceIntoView(privateRow);
  await expect(privateRow).toBeInViewport({ ratio: 1 });
  const scroller = await privateRow.evaluate((element) => {
    const content = element.closest(".MuiDialogContent-root")!;
    const row = element.getBoundingClientRect();
    const clip = content.getBoundingClientRect();
    return {
      rowTop: row.top,
      rowBottom: row.bottom,
      clipTop: clip.top,
      clipBottom: clip.bottom,
      scrollTop: content.scrollTop,
      clientHeight: content.clientHeight,
      scrollHeight: content.scrollHeight,
    };
  });
  expect(scroller.rowTop).toBeGreaterThanOrEqual(scroller.clipTop);
  expect(scroller.rowBottom).toBeLessThanOrEqual(scroller.clipBottom);
  await test.info().attach("author-report-scroller-geometry", {
    body: JSON.stringify(scroller, null, 2),
    contentType: "application/json",
  });
  if (process.env.REVIEW_SCREENSHOT_DIR)
    await fs.writeFile(
      path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `mod-author-geometry-${page.viewportSize()!.width}-${theme}.json`,
      ),
      JSON.stringify(scroller, null, 2),
    );
  await expect(
    page.locator("iframe#webpack-dev-server-client-overlay"),
  ).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await screenshot(
    page,
    `mod-author-report-${page.viewportSize()!.width}-${theme}.png`,
  );
  const expert = report.getByRole("button", { name: "Expert", exact: true });
  await expert.focus();
  await page.keyboard.press("Enter");
  await expect(expert).toHaveAttribute("aria-pressed", "true");
  await expect(privateRow).toContainText(
    "Natural Gas fuel price: 140% of normal",
  );
  await expect(privateRow).toContainText("Active for 2 months");
  await expect(
    report.getByRole("button", {
      name: "Inherited objectives: replace-ready JSON",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    report.getByRole("button", {
      name: "Difficulty validation",
      exact: true,
    }),
  ).toBeEnabled();
  await scrollEvidenceIntoView(privateRow);
  await expect(privateRow).toBeInViewport({ ratio: 1 });
  for (const button of await report.getByRole("button").all())
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const closeReport = report.getByRole("button", {
    name: "Close report",
    exact: true,
  });
  await closeReport.focus();
  await expect(closeReport).toBeFocused();
  await expect(closeReport).toBeInViewport({ ratio: 1 });
  await input("back");
  await expect(report).toBeHidden();
  await play.focus();
  await input("confirm");
  await expect(details).toBeVisible();
  await controllerSelect(
    details.getByRole("button", { name: "Starting fleet", exact: true }),
  );
  await input("confirm");
  await expect(
    details.getByRole("region", { name: "Starting fleet" }),
  ).toBeVisible();
  await input("back");
  await expect(details).toBeHidden();
  expect(await page.evaluate(() => window.__mods.scores)).toBe(0);
  await playAndCheckRun(page, "Connection Planning");
  const saved = (await readSavedGame(page))!;
  expect(saved.customScenario!.mod!.rules.startingPeakW).toBeGreaterThan(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`author report keeps maintenance branches concise in ${theme}`, async ({
    page,
  }) => {
    const maintenance = validateMod(
      JSON.parse(
        await fs.readFile(
          path.resolve(
            __dirname,
            "../docs/mods/examples/bridge-the-maintenance-gap.json",
          ),
          "utf8",
        ),
      ),
    );
    const startingYear = theme === "dark" ? 2030 : 2020;
    maintenance.scenario = { ...maintenance.scenario, startingYear };
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await mockDesktop(page, false, theme, [
      {
        key: `local:${maintenance.id}`,
        source: "local",
        enabled: true,
        pack: maintenance,
      },
    ]);
    await page.goto("/");
    await page.getByRole("button", { name: "Mods", exact: true }).click();
    const play = page.getByRole("button", {
      name: `Play ${maintenance.title}`,
      exact: true,
    });
    await expect(play).toBeEnabled({ timeout: 60000 });
    await play.click();
    const details = page.getByRole("dialog", {
      name: `Play ${maintenance.title}`,
      exact: true,
    });
    const announced = details.getByRole("region", {
      name: "Announced timeline",
    });
    await expect(announced).toContainText(
      `The original gas peaker will be offline from January ${startingYear + 1} until April ${startingYear + 1}.`,
    );
    await expect(announced).toContainText(
      `The original gas peaker will be offline from January ${startingYear + 1} until July ${startingYear + 1}.`,
    );
    await expect(details).not.toContainText("{{");
    await expect(details).not.toContainText("starting-year dollars");
    await scrollEvidenceIntoView(announced);
    await screenshot(
      page,
      `mod-date-preview-${page.viewportSize()!.width}-${theme}.png`,
    );
    await details.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(details).toBeHidden();
    await page
      .getByRole("button", {
        name: `Author validation report for ${maintenance.title}`,
        exact: true,
      })
      .click();
    const report = page.getByRole("dialog", {
      name: `Author validation report: ${maintenance.title}`,
      exact: true,
    });
    await expect(
      report.getByRole("region", { name: "Scenario diagnostics" }),
    ).toBeInViewport();
    await report
      .getByRole("button", { name: "Affected generators", exact: true })
      .click();
    const targets = report.getByRole("region", { name: "Affected generators" });
    await expect(targets.locator("dt")).toHaveCount(2);
    await expect(targets).toContainText("Months 13–15");
    await expect(targets).toContainText("Months 13–18");
    await expect(targets).toContainText("Shorten the outage");
    await expect(targets).toContainText("Take funding");
    await expect(targets).toContainText("0% output");
    await report
      .getByRole("button", { name: "Combined effects by month", exact: true })
      .click();
    const monthly = report.getByRole("region", {
      name: "Combined effects by month",
    });
    await expect(monthly.locator("dt")).toHaveCount(4);
    await expect(monthly).toContainText("Months 13–15");
    await expect(monthly).toContainText("Months 16–18");
    await expect(monthly).toContainText(
      "accelerate-overhaul, standard-overhaul",
    );
    await scrollEvidenceIntoView(monthly);
    expect(await noHorizontalScroll(page)).toBe(true);
    await expect(
      page.locator("iframe#webpack-dev-server-client-overlay"),
    ).toHaveCount(0);
    await screenshot(
      page,
      `mod-author-copy-${page.viewportSize()!.width}-${theme}.png`,
    );
    await report
      .getByRole("button", { name: "Close report", exact: true })
      .click();
    await expect(report).toBeHidden();
  });
}
