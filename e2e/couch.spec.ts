import { expect, test } from "./fixtures";
import type {
  BrowserContext,
  Frame,
  Locator,
  Page,
  Route,
} from "@playwright/test";
import { createHash } from "node:crypto";
import path from "node:path";
import { TICK_MINUTES } from "../src/Constants";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "../src/helpers/DateTime";
import { peerCorridorId } from "../src/data/Multiplayer";
import { createCouchFixture, readCouchRoomView } from "./couch-fixture";
import type { CouchFixture } from "./couch-fixture";
import { claimToPeerBorder } from "./territorial-multiplayer";

test("TV Play with friends keeps couch play available when online play is disconnected", async ({
  context,
  page,
}) => {
  await createCouchFixture(context, page, { steamOnline: false });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play with friends", exact: true })
    .click();
  const lobby = page.getByRole("dialog", { name: "Play with friends" });
  await expect(
    lobby.getByText(
      "Connect to Steam or open Electrify in your browser to play online.",
    ),
  ).toBeVisible();
  await expect(
    lobby.getByRole("button", { name: "Host a game" }),
  ).toBeDisabled();
  const local = lobby.getByRole("button", { name: "Local Co-op", exact: true });
  await expect(local).toBeEnabled();
  await local.click();
  const setup = page.getByRole("dialog", { name: "Local Co-op · Two players" });
  await expect(setup.getByText("Press Confirm on your controller")).toHaveCount(
    2,
  );
  await expect(
    setup.getByRole("button", { name: "Choose a game" }),
  ).toBeDisabled();
});

test("TV couch setup explains missing Steam Input through the normal entry", async ({
  context,
  page,
}, info) => {
  await createCouchFixture(context, page, { steamInputAvailable: false });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play with friends", exact: true })
    .click();
  const lobby = page.getByRole("dialog", { name: "Play with friends" });
  await expect(
    lobby.getByRole("button", { name: "Host a game" }),
  ).toBeEnabled();
  if (process.env.REVIEW_SCREENSHOT_DIR)
    await lobby.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-entry-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
  await lobby.getByRole("button", { name: "Local Co-op", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Local Co-op · Two players" });
  await expect(setup.getByRole("alert")).toHaveText(
    /requires Steam Input.*Offline Mode/,
  );
  await expect(
    setup.getByRole("button", { name: "Choose a game" }),
  ).toBeDisabled();
});

async function startCouch<Actor extends Page | Frame>(
  page: Page,
  couch: CouchFixture<Actor>,
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play with friends", exact: true })
    .click();
  await page.getByRole("button", { name: "Local Co-op", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Local Co-op · Two players" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose a game", exact: true }),
  ).toBeDisabled();
  // The visible dialog renders before its native event subscription and setup finish.
  await expect
    .poll(() => couch.settledNativeRequests("setup"))
    .toBeGreaterThan(0);
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect(
    page.getByText("Controller joined", { exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Choose a game", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Custom setup" }),
  ).toBeVisible();
  // Couch specs play the Carbon Fee world: a coal plant, the rising-fee
  // forecast, and a 144-month term. Duration has to drop to 10 years before
  // the event is selected, because that arc then extends the game to 12 years.
  const duration = page.getByRole("combobox", {
    name: "Duration",
    exact: true,
  });
  await duration.click();
  await page.getByRole("option", { name: "10 years", exact: true }).click();
  const events = page.getByRole("combobox", {
    name: "Scenario events",
    exact: true,
  });
  await events.click();
  await page.getByRole("option", { name: "Carbon Fee", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(duration).toContainText("12 years");
  // The default peaker covers the whole month by itself, so pausing an extra
  // coal plant never creates the future shortfall these specs assert.
  // Replace it with a small gas plant plus a larger coal plant.
  await page
    .getByRole("button", { name: "Remove Natural Gas Peaker", exact: true })
    .click();
  const facilityType = page.getByRole("combobox", {
    name: "Facility type",
    exact: true,
  });
  const facilitySize = page.getByRole("combobox", {
    name: "Facility size",
    exact: true,
  });
  await facilityType.click();
  await page
    .getByRole("option", { name: "Natural Gas CC", exact: true })
    .click();
  await facilitySize.click();
  await page.getByRole("option", { name: "250MW", exact: true }).click();
  await page.getByRole("button", { name: "Add facility", exact: true }).click();
  await facilityType.click();
  await page.getByRole("option", { name: "Coal", exact: true }).click();
  await page.getByRole("button", { name: "Add facility", exact: true }).click();
  const startForEveryone = page.getByRole("button", {
    name: "Start for everyone",
    exact: true,
  });
  await expect(startForEveryone).toBeEnabled();
  await startForEveryone.click();
  const start = page
    .getByRole("dialog")
    .getByRole("button", { name: "Start for everyone", exact: true });
  await expect(start).toBeDisabled();
  const openReplies = await couch.settledNativeRequests("open");
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect.poll(() => couch.seats.size).toBe(2);
  // The fixture publishes seat actors before navigating them. The open reply
  // follows both navigations and attachments; map size alone is not readiness.
  await expect
    .poll(() => couch.settledNativeRequests("open"))
    .toBe(openReplies + 1);
  for (const [id, { page: seat }] of couch.seats) {
    await expect(seat.locator("html")).toHaveAttribute("data-couch-seat", id);
    await expect(seat.locator("#appbar:visible")).toBeVisible();
  }
}

for (const nativeBindings of [false, true]) {
  test(`TV couch startup waits for delayed P2 navigation (native bindings=${nativeBindings})`, async ({
    context,
    page,
  }, info) => {
    test.skip(
      !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
      "Seat startup readiness in both palettes and transports",
    );
    const couch = nativeBindings
      ? await createCouchFixture(context, page, { nativeBindings: true })
      : await createCouchFixture(context, page);
    let documentReleased = false;
    let releaseDocument!: () => void;
    const heldDocument = new Promise<void>((resolve) => {
      releaseDocument = resolve;
    });
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    await context.route(/\?couchSeat=local-p2&generation=/, async (route) => {
      // Fault injection only: make the real second-seat document slower than
      // the map-size poll. Startup must await readiness, not an assumed delay.
      releaseTimer = setTimeout(() => {
        documentReleased = true;
        releaseDocument();
      }, 1000);
      await heldDocument;
      await route.continue();
    });
    try {
      await startCouch(page, couch);
      const openReplies = await couch.settledNativeRequests("open");
      await info.attach("startup-readiness", {
        body: JSON.stringify({
          documentReleased,
          openReplies,
          seats: [...couch.seats].map(([id, route]) => ({
            id,
            generation: route.generation,
            url: route.page.url(),
          })),
        }),
        contentType: "application/json",
      });
      expect(documentReleased).toBe(true);
      expect(openReplies).toBe(1);
      const p1 = couch.seats.get("local-p1")!.page;
      const p2 = couch.seats.get("local-p2")!.page;
      await couch.input({ "101": ["menu"] });
      const menu = page.getByRole("dialog", { name: "Game menu", exact: true });
      await expect(menu).toBeVisible();
      await menu
        .getByRole("button", { name: "Return to game", exact: true })
        .click();
      await expect(menu).toHaveCount(0);
      await couch.input({ "202": ["build"] });
      await expect(
        p2.getByRole("region", { name: "Build", exact: true }),
      ).toBeVisible();
      await expect(
        p1.getByRole("region", { name: "Build", exact: true }),
      ).toHaveCount(0);
    } finally {
      clearTimeout(releaseTimer);
      releaseDocument();
      await context.unrouteAll({ behavior: "wait" });
    }
  });
}

const speedControls = (seat: Page | Frame) =>
  seat.getByRole("group", { name: "your game speed", exact: true });
const clock = (seat: Page | Frame) =>
  // The global overlay hides embedded player views. Read their rendered clock
  // state while all interaction queries remain visible-only.
  seat.getByRole("group", {
    name: "your game speed",
    exact: true,
    includeHidden: true,
  });
async function runNormally(...seats: (Page | Frame)[]) {
  for (const seat of seats)
    await speedControls(seat)
      .getByRole("button", { name: "normal speed", exact: true })
      .click();
  for (const seat of seats)
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
}
async function renderedFontSize(element: Locator) {
  return element.evaluate((node) =>
    parseFloat(getComputedStyle(node).fontSize),
  );
}

async function expectCompanyMoneyRow(seat: Page | Frame) {
  const geometry = await seat.locator(".gameBalance").evaluate((balance) => {
    const cash = balance
      .querySelector(".gameStatusValue")!
      .getBoundingClientRect();
    const profit = balance
      .querySelector(".gameMonthlyProfit")!
      .getBoundingClientRect();
    return {
      cash: {
        left: cash.left,
        right: cash.right,
        top: cash.top,
        bottom: cash.bottom,
      },
      profit: {
        left: profit.left,
        right: profit.right,
        top: profit.top,
        bottom: profit.bottom,
      },
    };
  });
  expect
    .soft(geometry.profit.left, "profit sits beside company cash")
    .toBeGreaterThan(geometry.cash.right);
  expect
    .soft(
      Math.min(geometry.cash.bottom, geometry.profit.bottom) -
        Math.max(geometry.cash.top, geometry.profit.top),
      "cash and monthly profit share one row",
    )
    .toBeGreaterThan(0);
}

async function expectSettingsClearance(globalSettings: Locator) {
  const back = globalSettings.getByRole("button", {
    name: "Back",
    exact: true,
  });
  const credits = globalSettings.getByRole("button", {
    name: "Credits and licenses",
    exact: true,
  });
  const footer = globalSettings.getByRole("complementary", {
    name: "Controller controls",
    exact: true,
  });
  await credits.scrollIntoViewIfNeeded();
  await expect(back).toBeInViewport();
  await expect(credits).toBeInViewport();
  await expect
    .poll(
      async () => {
        const [header, bottomControl, legend] = await Promise.all([
          back.boundingBox(),
          credits.boundingBox(),
          footer.boundingBox(),
        ]);
        return header && bottomControl && legend
          ? Math.max(
              header.y + header.height,
              bottomControl.y + bottomControl.height,
            ) - legend.y
          : Infinity;
      },
      {
        message:
          "normal Settings header and scroll controls stay above Controls",
      },
    )
    .toBeLessThanOrEqual(0);
  await globalSettings
    .getByRole("button", { name: "System", exact: true })
    .scrollIntoViewIfNeeded();
}

async function expectSharedSettings(globalSettings: Locator) {
  await expect(
    globalSettings.getByRole("heading", { name: "Settings", exact: true }),
  ).toHaveCount(1);
  await expect(
    globalSettings.getByRole("heading", {
      name: /Utility|TV session settings/,
    }),
  ).toHaveCount(0);
  await expect(
    globalSettings.getByRole("button", {
      name: "Return to all companies",
      exact: true,
    }),
  ).toHaveCount(0);
  const controls = globalSettings.getByRole("complementary", {
    name: "Controller controls",
    exact: true,
  });
  await expect(controls.locator("strong")).toHaveText("Controls");
  await expect(controls).not.toContainText(/P[12]|Utility/);
}

async function expectSharedMenu(page: Page, menu: Locator) {
  await expect(menu).toBeVisible();
  for (const name of ["Return to game", "Manual", "Settings", "Quit"])
    await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();
  const controls = menu.getByRole("complementary", {
    name: "Controller controls",
    exact: true,
  });
  await expect(controls.locator("strong")).toHaveText("Controls");
  await expect(controls).not.toContainText(/P[12]|Utility/);
  const bounds = await menu.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(
    Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2),
  ).toBeLessThan(2);
  expect(
    Math.abs(bounds!.y + bounds!.height / 2 - viewport.height / 2),
  ).toBeLessThan(viewport.height * 0.15);
  const backdropAlpha = await menu.evaluate((dialog) => {
    const backdrop = dialog
      .closest(".MuiModal-root")!
      .querySelector(".MuiBackdrop-root")!;
    const color = getComputedStyle(backdrop).backgroundColor;
    return color.startsWith("rgba(")
      ? Number(color.split(",").at(-1)!.replace(")", ""))
      : 1;
  });
  expect(backdropAlpha).toBeGreaterThan(0);
  expect(backdropAlpha).toBeLessThan(1);
  await expect(controls).toHaveCSS("opacity", "1");
  const focused = menu.getByRole("button", {
    name: "Return to game",
    exact: true,
  });
  await focused.focus();
  await expect(focused).toBeFocused();
  const expectedColor = await focused.evaluate((button) => {
    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(button).getPropertyValue(
      "--interactive-contrast",
    );
    button.appendChild(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return expected;
  });
  await expect(focused).toHaveCSS("color", expectedColor);
}

async function expectSharedCaptionSize(
  page: Page,
  seat: Page | Frame,
  zoom: number,
) {
  await expect
    .poll(
      async () => {
        const status = seat.locator(".gridHealth").first();
        const namedStatus = status.locator(".gridStatusNow");
        const reserveFont = await renderedFontSize(
          // The current quantity shares the global caption ramp at every pane width.
          (await namedStatus.count()) ? namedStatus.first() : status,
        );
        const fonts = await Promise.all([
          renderedFontSize(page.locator(".couchCalendar .gameStatusValue")),
          renderedFontSize(page.locator(".missionRiskText")),
          renderedFontSize(page.locator(".missionSummaryMonths > span")),
        ]);
        return Math.max(
          ...fonts.map((font) => Math.abs(font - reserveFont * zoom)),
        );
      },
      {
        message: "shared date/event/months matches physical reserve-label font",
      },
    )
    .toBeLessThan(0.5);
}

async function expectPlayersPainted(page: Page) {
  for (const id of ["local-p1", "local-p2"]) {
    const snapshot = page.locator(`[data-couch-backdrop-seat="${id}"]`);
    await expect(
      snapshot,
      `${id} remains painted beneath the shared overlay`,
    ).toBeVisible();
    await expect
      .poll(() =>
        snapshot.evaluate(
          (image) =>
            (image as HTMLImageElement).complete &&
            (image as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
    // Native views hide only after the shell has decoded the real seat captures.
    await expect(page.locator(`#couch-fixture-${id}`)).toBeHidden();
    const nativeBounds = await page
      .locator(`#couch-fixture-${id}`)
      .evaluate((frame) => {
        const rect = frame.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
    const paintedBounds = await snapshot.boundingBox();
    expect(paintedBounds).not.toBeNull();
    for (const key of ["x", "y", "width", "height"] as const)
      expect(paintedBounds![key]).toBeCloseTo(nativeBounds[key], 0);
  }
}

async function pointerTarget(page: Page, seat: Frame, button: Locator) {
  const seatId = await seat.locator("html").getAttribute("data-couch-seat");
  const bounds = await button.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const frame = await page
    .locator(`#couch-fixture-${seatId}`)
    .evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        zoom: new DOMMatrix(getComputedStyle(node).transform).a,
      };
    });
  // Observe the real event target, including when the coordinator would reject
  // its command. The global overlay must intercept the pointer before the pane.
  await button.evaluate((target) =>
    target.addEventListener(
      "click",
      () => {
        document.documentElement.dataset.couchPointerLeak = "true";
      },
      { once: true },
    ),
  );
  await page.mouse.click(
    frame.x + (bounds.x + bounds.width / 2) * frame.zoom,
    frame.y + (bounds.y + bounds.height / 2) * frame.zoom,
  );
  await expect(seat.locator("html")).not.toHaveAttribute(
    "data-couch-pointer-leak",
    "true",
  );
}

async function expectSeatChromeRemoved(seat: Page | Frame) {
  await expect(seat.locator(".couchIdentity")).toHaveCount(0);
  await expect(seat.locator(".gameMenuButton")).toHaveCount(0);
  await expect(seat.locator("#yearProgressBar")).toHaveCount(0);
  await expect(seat.locator(".missionSummary")).toHaveCount(0);
  await expect(seat.locator(".controllerHints")).toHaveCount(0);
  await expect(seat.locator(".gameDockLabel")).toHaveCount(0);
  await expect(speedControls(seat)).toBeVisible();
  await expect(
    seat.locator("#appbar").getByRole("group", {
      name: "your game speed",
      exact: true,
    }),
  ).toHaveCount(1);
  for (const name of ["Build", "Programs", "Insights", "Events", "Scenario"])
    await expect(seat.getByRole("button", { name, exact: true })).toBeVisible();
}

test("TV couch companies keep independent dialogs and purchases through atomic save and resume", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Two seat renderer journey at 1080p in each palette",
  );
  const couch = await createCouchFixture(context, page, {
    nativeBindings: true,
  });
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  for (const seat of [p1, p2]) {
    await expect(seat.locator("#appbar:visible")).toBeVisible();
    await expect(seat.locator(".gameStage")).toHaveAttribute(
      "data-layout",
      "single",
    );
  }
  await expect(page.locator(".appFrameBody")).toBeHidden();
  await expect(speedControls(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "menu", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#yearProgressBar")).toHaveCount(1);
  await expect(page.locator(".missionSummary")).toBeVisible();
  await expectSeatChromeRemoved(p1);
  await expectSeatChromeRemoved(p2);
  await runNormally(p1, p2);
  await expect.poll(() => couch.checkpoint()?.grids.length).toBe(2);
  const originalCounts = couch
    .checkpoint()!
    .grids.map((grid) => grid.facilities.length);
  await couch.input({ "101": ["build"], "202": ["build"] });
  const build1 = p1.getByRole("region", { name: "Build", exact: true });
  const build2 = p2.getByRole("region", { name: "Build", exact: true });
  await expect(build1).toBeVisible();
  await expect(build2).toBeVisible();
  const review1 = build1.getByRole("button", {
    name: "Review purchase of Solar",
    exact: true,
  });
  const review2 = build2.getByRole("button", {
    name: "Review purchase of Solar",
    exact: true,
  });
  // Each document retains its own real focus; both devices confirm in the same sample.
  await review1.focus();
  await review2.focus();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  const purchase1 = p1.getByRole("dialog");
  const purchase2 = p2.getByRole("dialog");
  await expect(purchase1).toBeVisible();
  await expect(purchase2).toBeVisible();
  await purchase1
    .getByRole("button", { name: "Take loan", exact: true })
    .focus();
  await purchase2
    .getByRole("button", { name: "Take loan", exact: true })
    .focus();
  await couch.input({ "101": ["confirm"] });
  await expect(purchase1).toHaveCount(0);
  await expect(purchase2).toBeVisible();
  await expect(
    purchase2.getByRole("button", { name: "Take loan", exact: true }),
  ).toBeFocused();
  await couch.input({ "202": ["confirm"] });
  await expect(purchase2).toHaveCount(0);
  await expect(build1).toHaveCount(0);
  await expect(build2).toHaveCount(0);
  await p2.getByRole("button", { name: "Insights", exact: true }).click();
  await expect(
    p2.getByRole("region", { name: "Insights", exact: true }),
  ).toBeVisible();
  await couch.input({ "101": ["menu"] });
  const gameMenu = page.getByRole("dialog", { name: "Game menu", exact: true });
  await expectSharedMenu(page, gameMenu);
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "PAUSED");
  await expect(clock(p2)).toHaveAttribute("data-active-speed", "PAUSED");
  await expect(
    page.getByRole("complementary", {
      name: "Controller controls",
      exact: true,
    }),
  ).toBeVisible();

  await expect(
    page
      .getByRole("complementary", {
        name: "Controller controls",
        exact: true,
      })
      .getByRole("img", { name: "Right stick up", exact: true }),
  ).toBeVisible();
  await couch.input({ "202": ["down"] });
  await expect(
    gameMenu.getByRole("button", { name: "Manual", exact: true }),
  ).toBeFocused();
  await couch.input({ "202": ["down"] });
  await expect(
    gameMenu.getByRole("button", { name: "Settings", exact: true }),
  ).toBeFocused();
  await couch.input({ "202": ["confirm"] });

  const globalSettings = page.getByRole("dialog", {
    name: "Settings",
    exact: true,
  });
  await expectSharedSettings(globalSettings);
  await expect(
    globalSettings.getByRole("heading", {
      name: "Settings",
      exact: true,
    }),
  ).toBeVisible();
  await p2.evaluate(() =>
    window.electrifyCouch!.post({
      kind: "global-settings",
      requestId: "p2-settings",
    }),
  );
  // Shared settings remain one dialog while both companies' gameplay controls are gated.
  await couch.input({ "202": ["build"] });
  await expect(
    globalSettings.getByRole("heading", {
      name: "Settings",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    p2.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  await globalSettings
    .getByRole("button", { name: "Back", exact: true })
    .click();
  await expect(globalSettings).toHaveCount(0);
  await expect(purchase1).toHaveCount(0);
  await expect(
    p2.getByRole("region", { name: "Insights", exact: true }),
  ).toBeVisible();
  await expect(
    p1.getByRole("region", { name: "Insights", exact: true }),
  ).toHaveCount(0);
  await expect(p2.locator(".insights:visible .uplot").first()).toBeVisible();
  // A purchase review remains usable while the partner's real forecast/chart is open.
  await couch.input({ "101": ["build"] });
  await build1
    .getByRole("button", { name: "Review purchase of Solar", exact: true })
    .focus();
  await couch.input({ "101": ["confirm"] });
  await expect(purchase1).toBeVisible();
  await expect(
    p2.getByRole("region", { name: "Insights", exact: true }),
  ).toBeVisible();
  for (const seat of [p1, p2]) {
    const dismiss = seat.getByRole("button", {
      name: "Dismiss notification",
      exact: true,
    });
    if (await dismiss.isVisible()) await dismiss.click();
    await expect(dismiss).toHaveCount(0);
  }
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await p1.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-p1-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
    await p2.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-p2-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
  }
  await couch.input({ "101": ["back"] });
  await expect(purchase1).toHaveCount(0);
  await couch.input({ "101": ["menu"] });
  await expect(
    gameMenu.getByRole("button", { name: "Return to game", exact: true }),
  ).toBeFocused();
  const quit = gameMenu.getByRole("button", { name: "Quit", exact: true });
  await couch.input({ "202": ["up"] });
  await expect(quit).toBeFocused();
  await couch.input({ "202": ["confirm"] });
  const saveDialog = page.getByRole("dialog", {
    name: "Save & Quit for everyone?",
    exact: true,
  });
  const save = saveDialog.getByRole("button", {
    name: "Save & Quit",
    exact: true,
  });
  await expect(saveDialog).toContainText(
    "P2 Utility wants to end this TV session",
  );
  await expect(save).toBeEnabled();
  couch.setSaveFailure(true);
  const previousSave = couch.checkpoint();
  await page.evaluate(() => {
    const confirms: string[] = [];
    Object.defineProperty(window, "__couchSaveConfirms", { value: confirms });
    window.addEventListener("couchControllerInput", (event) => {
      const { id, actions } = (
        event as CustomEvent<{ id: string; actions: string[] }>
      ).detail;
      if (actions.includes("confirm")) confirms.push(id);
    });
  });
  const routedConfirms = () =>
    page.evaluate(
      () =>
        (window as Window & { __couchSaveConfirms?: string[] })
          .__couchSaveConfirms,
    );
  await save.focus();
  await couch.input({ "101": ["confirm"] });
  expect(await routedConfirms()).toEqual([]);
  await couch.input({ "202": ["confirm"] });
  expect(await routedConfirms()).toEqual(["202"]);
  await expect(saveDialog.getByRole("alert")).toContainText(
    "Fixture local storage is full",
  );
  await expect(save).toBeEnabled();
  expect(couch.checkpoint()).toBe(previousSave);
  expect(couch.seats.get("local-p1")?.page).toBe(p1);
  expect(couch.seats.get("local-p2")?.page).toBe(p2);

  couch.setSaveFailure(false);
  await save.click();
  await expect.poll(() => couch.seats.size).toBe(0);
  const complete = couch.checkpoint()!;
  expect(complete.grids.map((grid) => grid.facilities.length)).toEqual(
    originalCounts.map((count) => count + 1),
  );
  expect(complete.edges).toHaveLength(1);
  expect(Object.keys(complete.receipts)).toEqual(
    expect.arrayContaining(["local-p1", "local-p2"]),
  );
  await page
    .getByRole("button", { name: "Play with friends", exact: true })
    .click();
  await page.getByRole("button", { name: "Local Co-op", exact: true }).click();
  await page.getByRole("button", { name: /^Resume Local campaign/ }).click();
  for (const name of ["P1 company", "P2 company"])
    await expect(
      page.getByRole("textbox", { name, exact: true }),
    ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review saved game", exact: true }),
  ).toBeDisabled();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect(
    page.getByText("Controller joined", { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Review saved game", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review saved game", exact: true })
    .click();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect.poll(() => couch.seats.size).toBe(2);
  await expect.poll(() => couch.checkpoint()?.epoch).not.toBe(complete.epoch);
  expect(
    couch.checkpoint()!.grids.map((grid) => grid.facilities.length),
  ).toEqual(complete.grids.map((grid) => grid.facilities.length));
});

test("TV couch intertie construction requires approval from both company owners", async ({
  context,
  page,
}, info) => {
  test.skip(
    info.project.name !== "tv-1080-light",
    "Shared intertie approval journey",
  );
  const couch = await createCouchFixture(context, page, {
    nativeBindings: true,
  });
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  const readP1 = () => readCouchRoomView(p1).then((view) => view!.game!);
  await expect
    .poll(
      async () =>
        (await readCouchRoomView(p1))?.game?.multiplayer?.territorial
          ?.seatCount,
    )
    .toBe(2);
  await claimToPeerBorder(p1, "local-p2", readP1);
  for (const seat of [p1, p2])
    await seat.getByRole("button", { name: "Agreements", exact: true }).click();
  await p1
    .getByRole("button", { name: "Review connection with P2 Utility" })
    .click();
  const p1Cash = p1
    .getByRole("dialog")
    .getByRole("button", { name: "Propose connection" });
  await p1Cash.focus();
  await couch.input({ "101": ["confirm"] });
  await expect(p1Cash).toHaveCount(0);
  const waitingForP2 = p1.getByText(/P2 Utility must approve/);
  await expect(waitingForP2).toBeVisible();

  await p2
    .getByRole("button", { name: "Review connection from P1 Utility" })
    .click();
  const p2Cash = p2
    .getByRole("dialog")
    .getByRole("button", { name: "Accept connection" });
  const p1Normal = speedControls(p1).getByRole("button", {
    name: "normal speed",
    exact: true,
  });
  await expect(p1Normal).toHaveAttribute("aria-pressed", "false");
  await p1Normal.focus();
  await p2Cash.focus();
  await couch.input({ "101": ["confirm"] });
  // Observe P1's selection change before checking that the approval is still pending.
  await expect(p1Normal).toHaveAttribute("aria-pressed", "true");
  await expect(waitingForP2).toBeVisible();
  await expect(p2Cash).toBeEnabled();
  await couch.input({ "202": ["confirm"] });
  await expect(p2Cash).toHaveCount(0);
  await expect(p2.getByText(/^Construction underway/)).toBeVisible();

  await couch.input({ "202": ["menu"] });
  await page
    .getByRole("dialog", { name: "Game menu", exact: true })
    .getByRole("button", { name: "Quit", exact: true })
    .click();
  await page.getByRole("button", { name: "Save & Quit", exact: true }).click();
  await expect.poll(() => couch.seats.size).toBe(0);
  const complete = couch.checkpoint()!;
  const edge = complete.edges[0];
  expect(complete.spec.territorialVersion).toBe(1);
  expect(edge).toMatchObject({ ratingW: 0, flowW: 0 });
  const lines = complete.grids.map(({ transmission }) =>
    transmission!.lines.find(
      (line) => line.corridorId === peerCorridorId(edge.id),
    ),
  );
  for (const line of lines) expect(line?.yearsToBuildLeft).toBeGreaterThan(0);
});

for (const withP2 of [false, true]) {
  test(
    withP2
      ? "TV couch lets P2 save monthly bankruptcy results"
      : "TV couch resumes with an absent retired controller and completes the remaining company",
    async ({ context, page, colorScheme }, info) => {
      test.skip(
        info.project.name !== (withP2 ? "tv-1080-dark" : "tv-1080-light"),
        "Monthly bankruptcy and results routing",
      );
      await verifyMonthlyBankruptcyResults(
        context,
        page,
        withP2,
        colorScheme === "dark" ? "rgb(239, 83, 80)" : "rgb(198, 40, 40)",
      );
    },
  );
}

async function verifyMonthlyBankruptcyResults(
  context: BrowserContext,
  page: Page,
  withP2: boolean,
  warningColor: string,
) {
  const couch = await createCouchFixture(context, page, {
    nativeBindings: true,
  });
  await startCouch(page, couch);
  await couch.input({ "101": ["menu"] });
  await page
    .getByRole("dialog", { name: "Game menu", exact: true })
    .getByRole("button", { name: "Quit", exact: true })
    .click();
  await page.getByRole("button", { name: "Save & Quit", exact: true }).click();
  await expect.poll(() => couch.seats.size).toBe(0);

  // Resume just before a real monthly bankruptcy check. A retired P2 stays at its original minute.
  const saved = structuredClone(couch.checkpoint()!);
  const [firstGrid, secondGrid] = saved.grids;
  const retiredAt = secondGrid.date.minute;
  const beforeRollover = MINUTES_PER_MONTH - 16 * TICK_MINUTES;
  for (const grid of withP2 ? saved.grids : [firstGrid]) {
    const offset = beforeRollover - grid.date.minute;
    grid.date = getDateFromMinute(beforeRollover, grid.startingYear);
    for (const tick of grid.timeline) tick.minute += offset;
    getTimeFromTimeline(beforeRollover, grid.timeline)!.cash = -1e12;
  }
  if (!withP2) {
    const ending = {
      title: "Bankrupt!",
      outcome: "bankrupt",
      month: secondGrid.date.monthsElapsed,
    } as const;
    secondGrid.multiplayer!.ending = ending;
    saved.outcomes["local-p2"] = ending;
    await couch.setConnected({ "202": false });
  }
  couch.seedCheckpoint(saved);
  const confirmPlayers: Record<string, ["confirm"]> = withP2
    ? { "101": ["confirm"], "202": ["confirm"] }
    : { "101": ["confirm"] };

  await page
    .getByRole("button", { name: "Play with friends", exact: true })
    .click();
  await page.getByRole("button", { name: "Local Co-op", exact: true }).click();
  await page.getByRole("button", { name: /^Resume Local campaign/ }).click();
  const review = page.getByRole("button", {
    name: "Review saved game",
    exact: true,
  });
  await expect(review).toBeDisabled();
  await couch.input(confirmPlayers);
  await page
    .getByRole("button", { name: "Review saved game", exact: true })
    .click();
  await couch.input(confirmPlayers);
  await expect.poll(() => couch.seats.size).toBe(2);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  if (!withP2)
    await expect(
      p2.getByRole("region", { name: "Company result" }),
    ).toContainText("Bankrupt!");
  await expect(
    page.getByText(/P2 Utility: controller disconnected/),
  ).toHaveCount(0);
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "PAUSED");
  const players = [{ seat: p1, device: "101", id: "local-p1" }];
  if (withP2) players.push({ seat: p2, device: "202", id: "local-p2" });
  for (const { seat, device, id } of players) {
    await seat
      .getByRole("dialog", { name: "Low on cash", exact: true })
      .getByRole("button", { name: "Go bankrupt", exact: true })
      .focus();
    await couch.input({ [device]: ["confirm"] });
    await expect(seat.getByRole("dialog", { includeHidden: true })).toHaveCount(
      0,
    );
    const cash = seat.locator(".gameBalance > .gameStatusValue");
    await expect(cash).toHaveAttribute("data-couch-player", id);
    await expect(cash).toHaveCSS("color", warningColor);
    if (process.env.REVIEW_SCREENSHOT_DIR && id === "local-p1")
      await seat.locator("#topbar").screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `couch-cash-${withP2 ? "dark" : "light"}.png`,
        ),
        animations: "disabled",
      });
    await speedControls(seat)
      .getByRole("button", { name: "slow speed", exact: true })
      .focus();
    await couch.input({ [device]: ["confirm"] });
  }
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "SLOW");

  const results = page.getByRole("dialog", {
    name: "Match complete",
    exact: true,
  });
  await expect(results).toContainText("P1 · P1 Utility: Bankrupt!", {
    timeout: 30000,
  });
  await expect(results).toContainText("P2 · P2 Utility: Bankrupt!");
  await results.getByRole("button", { name: "Save & return to setup" }).focus();
  const requester = withP2 ? "202" : "101";
  await couch.input({ [requester]: ["confirm"] });
  const confirmation = page.getByRole("dialog", {
    name: "Save & Quit for everyone?",
  });
  await expect(confirmation).toContainText(
    `P${withP2 ? 2 : 1} Utility wants to end this TV session`,
  );
  const save = confirmation.getByRole("button", {
    name: "Save & Quit",
    exact: true,
  });
  await expect(save).toBeEnabled();
  await save.focus();
  await couch.input({ [requester]: ["confirm"] });
  await expect.poll(() => couch.seats.size).toBe(0);
  await expect(
    page.getByRole("heading", { name: "Local Co-op · Two players" }),
  ).toBeVisible();
  const finished = couch.checkpoint()!;
  expect(finished.outcomes).toMatchObject({
    "local-p1": { outcome: "bankrupt" },
    "local-p2": { outcome: "bankrupt" },
  });
  expect(finished.grids[0].date.minute).toBeGreaterThanOrEqual(
    MINUTES_PER_MONTH,
  );
  if (withP2) {
    expect(finished.grids[1].date.minute).toBeGreaterThanOrEqual(
      MINUTES_PER_MONTH,
    );
  } else {
    expect(finished.grids[1].date.minute).toBe(retiredAt);
    expect(finished.edges[0]).toMatchObject({ disabled: true, flowW: 0 });
  }
}

test("TV couch applies padded bounds and exposes shared clock reasons through controller navigation", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-2160-dark"].includes(info.project.name),
    "Screen edge and clock verification at 1080p and 4K",
  );
  await context.addInitScript(() => {
    if (!new URLSearchParams(window.location.search).has("couchSeat")) {
      localStorage.setItem("screenEdgePadding", "4");
    }
  });
  const couch = await createCouchFixture(context, page, { embedded: true });
  await startCouch(page, couch);
  const route1 = couch.seats.get("local-p1")!;
  const route2 = couch.seats.get("local-p2")!;
  const p1 = route1.page;
  const p2 = route2.page;
  const { width, height } = page.viewportSize()!;
  const inset = Math.ceil(height * 0.04);
  const band = page.locator(".couchBand");
  await expect
    .poll(async () => Math.round((await band.boundingBox())!.y))
    .toBe(inset);
  await expect.poll(() => couch.layout()?.inset).toBe(inset);
  await expect
    .poll(async () => {
      const rect = (await band.boundingBox())!;
      return couch.layout()!.bounds[0].y - Math.ceil(rect.y + rect.height);
    })
    .toBe(0);
  const layout = couch.layout()!;
  expect(layout.fits).toBe(true);
  const [left, right] = layout.bounds;
  expect(left.x).toBe(inset);
  expect(right.x - left.x - left.width).toBe(8);
  expect(right.x + right.width).toBe(width - inset);
  expect(right.y + right.height).toBe(height - inset);
  for (const seat of [p1, p2]) {
    await expect(seat.locator("html")).toHaveAttribute(
      "data-interface-scale",
      "1.25",
    );
    await expect(seat.locator(".gameStage")).toHaveAttribute(
      "data-layout",
      "single",
    );
  }

  await runNormally(p1, p2);
  await couch.input({ "101": ["speedUp"] });
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "NORMAL");
  await expect(
    speedControls(p1).getByRole("button", { name: "fast speed", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(band.getByRole("group", { name: "Shared clock" })).toHaveCount(
    0,
  );
  const event = band.getByRole("button", {
    name: /^Upcoming: Carbon fee rising/,
  });
  const term = band.getByRole("button", {
    name: "144 months left",
    exact: true,
  });
  await expect(event).toBeVisible();
  await expect(term).toBeVisible();
  const eventBox = (await event.boundingBox())!;
  const termBox = (await term.boundingBox())!;
  expect(eventBox.x).toBeGreaterThan(width / 2);
  expect(termBox.x - eventBox.x - eventBox.width).toBeLessThan(24);
  const eventIcon = (await event.locator(".statusIcon svg").boundingBox())!;
  const eventFontSize = await renderedFontSize(
    event.locator(".missionRiskText"),
  );
  expect(eventIcon.height).toBeCloseTo(eventFontSize, 0);
  expect(eventIcon.width).toBeCloseTo(eventFontSize, 0);

  const verifySeatPalette = async (
    seat: Frame,
    seatId: string,
    speed: string,
  ) => {
    const cash = seat.locator(".gameBalance > .gameStatusValue");
    await expect(cash).toHaveAttribute("data-couch-player", seatId);
    const color = await cash.evaluate((node) => getComputedStyle(node).color);
    const group = speedControls(seat);
    await expect(group.locator(".multiplayerSpeedPip")).toHaveCount(0);
    const selection = group.getByRole("button", { name: speed, exact: true });
    await expect(selection).toHaveAttribute("aria-pressed", "true");
    expect(
      await selection.evaluate((node) => {
        const ring = getComputedStyle(node, "::before");
        return { color: ring.borderTopColor, width: ring.borderTopWidth };
      }),
    ).toEqual({ color, width: "2px" });
    return color;
  };
  const p1Color = await verifySeatPalette(p1, "local-p1", "fast speed");
  const p2Color = await verifySeatPalette(p2, "local-p2", "normal speed");
  expect(p1Color).not.toBe(p2Color);
  for (const seat of [p1, p2])
    await seat.getByRole("button", { name: "Agreements", exact: true }).click();
  const peerInP1 = p1
    .locator('[data-peer-id="local-p2"]')
    .getByText("P2 Utility", { exact: true });
  const peerInP2 = p2
    .locator('[data-peer-id="local-p1"]')
    .getByText("P1 Utility", { exact: true });
  await expect(peerInP1).toHaveAttribute("data-couch-player", "local-p2");
  await expect(peerInP1).toHaveCSS("color", p2Color);
  await expect(peerInP2).toHaveAttribute("data-couch-player", "local-p1");
  await expect(peerInP2).toHaveCSS("color", p1Color);
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-preview-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
    if (info.project.name === "tv-1080-light") {
      await Promise.all([
        peerInP1.scrollIntoViewIfNeeded(),
        peerInP2.scrollIntoViewIfNeeded(),
      ]);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          "couch-interties.png",
        ),
        animations: "disabled",
      });
    }
  }

  await couch.input({ "202": ["pause"] });
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "PAUSED");
  await couch.input({ "101": ["menu"] });
  const menu = page.getByRole("dialog", { name: "Game menu", exact: true });
  await expect(
    menu.getByRole("button", { name: "Return to game", exact: true }),
  ).toBeFocused();
  for (const label of ["Manual", "Settings", "Clock status"]) {
    await couch.input({ "101": ["down"] });
    await expect(
      menu.getByRole("button", { name: label, exact: true }),
    ).toBeFocused();
  }
  await couch.input({ "101": ["confirm"] });
  const details = page.getByRole("dialog", {
    name: "Clock status",
    exact: true,
  });
  const sharedClock = details.getByRole("group", { name: "Shared clock" });
  for (const label of ["Clock Paused", "P1 12×", "P2 Paused"])
    await expect(sharedClock.getByText(label, { exact: true })).toBeVisible();
  await expect(sharedClock).toContainText("Held by System, P2");
  await expect(sharedClock.getByText("P2 Paused", { exact: true })).toHaveCSS(
    "color",
    p2Color,
  );
  await expect(details).toContainText("P2 · P2 Utility");
  await expect(details).toContainText("Selected pause");
  await expect(details).toContainText("TV session dialog open");
  await expect(
    details.getByRole("button", { name: "Back to game menu", exact: true }),
  ).toBeFocused();
  await couch.input({ "101": ["confirm"] });
  await expect(menu).toBeVisible();
  await couch.input({ "101": ["menu"] });
  await expect(menu).toHaveCount(0);
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "PAUSED");

  await couch.resize(1130, 800);
  await expect(
    page.getByRole("heading", { name: "TV session paused", exact: true }),
  ).toBeVisible();
  expect(couch.layout()?.fits).toBe(false);
  await expect(page.locator("#couch-fixture-local-p1")).toBeHidden();
  const fastSelection = clock(p1).getByRole("button", {
    name: "fast speed",
    exact: true,
    includeHidden: true,
  });
  await couch.input({ "101": ["speedDown"] });
  await expect(fastSelection).toHaveAttribute("aria-pressed", "true");

  await page
    .getByRole("button", { name: "Save & Quit for everyone", exact: true })
    .focus();
  await couch.input({ "202": ["confirm"] });
  const exit = page.getByRole("dialog", { name: "Save & Quit for everyone?" });
  await expect(exit).toContainText("P2 Utility wants to end this TV session");
  const keepPlaying = exit.getByRole("button", {
    name: "Keep playing",
    exact: true,
  });
  await expect(keepPlaying).toBeEnabled();
  await keepPlaying.focus();
  await couch.input({ "101": ["confirm"] });
  await expect(exit).toBeVisible();
  await couch.input({ "202": ["confirm"] });
  await expect(exit).toHaveCount(0);

  const displaySettings = page.getByRole("button", {
    name: "Display settings",
    exact: true,
  });
  await displaySettings.focus();
  await couch.input({ "101": ["confirm"] });
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings
    .getByRole("button", { name: "Advanced display", exact: true })
    .click();
  const padding = settings.getByRole("group", {
    name: "Screen-edge padding",
    exact: true,
  });
  await padding.getByRole("button", { name: "0%", exact: true }).click();
  await expect.poll(() => couch.layout()?.fits).toBe(true);
  expect(couch.layout()?.inset).toBe(0);
  const overlays = await couch.settledNativeRequests("overlay");
  await settings.getByRole("button", { name: "Back", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect
    .poll(() => couch.settledNativeRequests("overlay"))
    .toBeGreaterThan(overlays);
  await couch.settleCaptures();
  await expect(
    page.getByRole("heading", { name: "TV session paused", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#couch-fixture-local-p1")).toBeVisible();
  expect(couch.seats.get("local-p1")).toBe(route1);
  expect(couch.seats.get("local-p2")).toBe(route2);
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "PAUSED");
  await expect(fastSelection).toHaveAttribute("aria-pressed", "true");
  await couch.input({ "101": ["speedDown"] });
  await expect(
    speedControls(p1).getByRole("button", {
      name: "normal speed",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "PAUSED");
  await speedControls(p2)
    .getByRole("button", { name: "normal speed", exact: true })
    .click();
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "NORMAL");
});

test("TV couch player toolbars match named warning captions after a plant pause", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Physical split-screen caption sizing in both palettes",
  );
  const couch = await createCouchFixture(context, page, { embedded: true });
  await startCouch(page, couch);
  const seat = couch.seats.get("local-p1")!.page;
  await seat.getByRole("button", { name: "Fleet", exact: true }).click();
  await seat.getByRole("button", { name: "Inspect Coal", exact: true }).click();
  await seat.getByRole("button", { name: "Pause Coal", exact: true }).click();
  // Pausing changes the forecast immediately. The current operating sample still
  // has reserve until the simulation advances; those facts must stay distinct.
  await expect(seat.locator(".gridHealth")).toHaveClass(
    /gridHealth-stable statusWarning/,
  );
  await expect(seat.locator(".gridStatusNow")).toHaveText(/NOW.*W.*reserve/);
  const warning = seat.locator(".gridStatusFuture");
  await expect(warning).toHaveText(/FUTURE Short at/);
  await expect(warning).toBeVisible();
  expect(await renderedFontSize(warning)).toBe(
    await renderedFontSize(seat.locator(".gridHealth:visible")),
  );
  await expectSharedCaptionSize(page, seat, couch.layout()!.zoom);
});

test("TV shared menu retains focus while refreshing player captures", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Embedded two-company capture in both palettes",
  );
  const couch = await createCouchFixture(context, page, { embedded: true });
  await startCouch(page, couch);
  await couch.input({ "101": ["menu"] });
  const menu = page.getByRole("dialog", { name: "Game menu", exact: true });
  await expect(menu).toBeVisible();
  await couch.settleCaptures();
  const focused = menu.getByRole("button", {
    name: "Return to game",
    exact: true,
  });
  await focused.focus();
  await expect(focused).toBeFocused();
  const revision = couch.backdropRevision();
  await page.evaluate(() =>
    window.electrifyDesktop!.couchRequest!({ kind: "refresh-overlay" }),
  );
  await couch.settleCaptures();
  await expect.poll(couch.backdropRevision).toBeGreaterThan(revision);
  await expect(focused).toBeFocused();
  await expectSharedMenu(page, menu);
});

test("TV couch player toolbars own speed with edge-to-edge panes and global pause", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Full two-company presentation at the 1080p couch preset in both palettes",
  );
  const couch = await createCouchFixture(context, page, { embedded: true });
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  for (const seat of [p1, p2]) {
    await expect(seat.locator("#appbar:visible")).toBeVisible();
    await expectSeatChromeRemoved(seat);
  }
  const zoom = couch.layout()!.zoom;
  for (const seat of [p1, p2]) await expectCompanyMoneyRow(seat);
  await expectSharedCaptionSize(page, p1, zoom);
  await expect(page.locator(".appFrameBody")).toBeHidden();
  await expect(speedControls(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "menu", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#yearProgressBar")).toHaveCount(1);
  await expect(page.locator(".missionSummary")).toBeVisible();
  await expect(page.locator(".missionRiskText")).toContainText(
    "Carbon fee rising",
  );
  await expect(page.getByRole("button", { name: /months left$/ })).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("complementary", {
      name: "Controller controls",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save & Quit for everyone", exact: true }),
  ).toHaveCount(0);
  await runNormally(p1, p2);
  await speedControls(p1)
    .getByRole("button", { name: "fast speed", exact: true })
    .click();
  await expect(
    speedControls(p1).getByRole("button", {
      name: "fast speed",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    speedControls(p2).getByRole("button", {
      name: "normal speed",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "NORMAL");
  // The clock's thumb, not the button, carries the fill: it sits under the running speed.
  await expect
    .poll(() =>
      speedControls(p1)
        .getByRole("button", { name: "normal speed", exact: true })
        .evaluate((button) => {
          const group = button.closest(".speedToggles")!;
          const style = getComputedStyle(group, "::before");
          const probe = document.createElement("span");
          probe.style.color =
            getComputedStyle(group).getPropertyValue("--speed-thumb");
          group.appendChild(probe);
          const expected = getComputedStyle(probe).color;
          probe.remove();
          const box = button.getBoundingClientRect();
          const centre =
            group.getBoundingClientRect().left +
            parseFloat(style.left) +
            new DOMMatrix(style.transform).m41 +
            parseFloat(style.width) / 2;
          return {
            filled: style.backgroundColor === expected,
            underButton: Math.abs(centre - (box.left + box.width / 2)) <= 1,
          };
        }),
    )
    .toEqual({ filled: true, underButton: true });
  await expect
    .poll(() =>
      speedControls(p1)
        .getByRole("button", { name: "fast speed", exact: true })
        .evaluate(
          (button) => getComputedStyle(button, "::before").borderTopWidth,
        ),
    )
    .toBe("2px");
  await speedControls(p2)
    .getByRole("button", { name: "slow speed", exact: true })
    .click();
  await expect(clock(p1)).toHaveAttribute("data-active-speed", "SLOW");
  await expect(
    speedControls(p1).getByRole("button", {
      name: "fast speed",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await runNormally(p1, p2);
  // Adaptive charts use the actual seat allocation. Keep the data and axes
  // readable and inside that allocation as the two company clocks run.
  for (const seat of [p1, p2]) {
    await expect(seat.locator("html")).toHaveAttribute(
      "data-interface-scale",
      "1.25",
    );
    await seat.getByRole("button", { name: "Fleet", exact: true }).click();
    const dailyChart = seat.locator(".facilitySupplyChart .accessibleChart");
    await expect(dailyChart).toBeVisible();
    const allocation = await dailyChart.evaluate((chart) => {
      const rect = chart.getBoundingClientRect();
      const viewport = chart
        .closest(".facilitiesBody")!
        .getBoundingClientRect();
      const plot = chart.querySelector(".u-over")!.getBoundingClientRect();
      const axes = Array.from(chart.querySelectorAll(".u-axis"));
      return {
        dataHeight:
          plot.height /
          parseFloat(getComputedStyle(document.documentElement).fontSize),
        viewportOverflow: Math.max(
          viewport.top - rect.top,
          rect.bottom - viewport.bottom,
        ),
        axisOverflow: Math.max(
          0,
          ...axes.map((axis) => {
            const box = axis.getBoundingClientRect();
            return Math.max(
              rect.left - box.left,
              box.right - rect.right,
              rect.top - box.top,
              box.bottom - rect.bottom,
            );
          }),
        ),
      };
    });
    expect(
      allocation.dataHeight,
      "daily data plot stays readable",
    ).toBeGreaterThanOrEqual(3);
    expect(
      allocation.viewportOverflow,
      "whole daily chart fits the company pane",
    ).toBeLessThanOrEqual(1);
    expect(
      allocation.axisOverflow,
      "daily axes fit their chart",
    ).toBeLessThanOrEqual(1);
  }
  await p2.getByRole("button", { name: "Insights", exact: true }).click();
  await expect(p2.locator(".insights:visible .uplot").first()).toBeVisible();
  await p2.locator(".insights:visible .uplot").first().scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  for (const seat of [p1, p2]) {
    await seat.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });
    await expect(seat.getByRole("tooltip")).toHaveCount(0);
  }
  const band = await page.locator(".couchBand").boundingBox();
  const layout = couch.layout();
  expect(band).not.toBeNull();
  expect(layout?.fits).toBe(true);
  expect(layout!.cssWidth).toBeGreaterThanOrEqual(360);
  for (const seat of [p1, p2]) {
    const viewport = await seat.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    expect(viewport.width).toBeGreaterThanOrEqual(360);
    expect(Math.abs(viewport.width - layout!.cssWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(viewport.height - layout!.cssHeight)).toBeLessThanOrEqual(
      1,
    );
  }
  expect(layout!.bounds[0].x).toBe(0);
  expect(layout!.bounds[1].x + layout!.bounds[1].width).toBe(1920);
  expect(layout!.bounds[1].x).toBeGreaterThan(
    layout!.bounds[0].x + layout!.bounds[0].width,
  );
  for (const [index, bounds] of layout!.bounds.entries()) {
    expect(bounds.y).toBe(Math.ceil(band!.y + band!.height));
    expect(bounds.y + bounds.height).toBe(1080);
    const rendered = await page
      .locator(`#couch-fixture-local-p${index + 1}`)
      .boundingBox();
    expect(rendered).not.toBeNull();
    expect(rendered!.x).toBeCloseTo(bounds.x, 1);
    expect(rendered!.y).toBeCloseTo(bounds.y, 1);
    expect(rendered!.x + rendered!.width).toBeCloseTo(
      bounds.x + bounds.width,
      1,
    );
    expect(rendered!.y + rendered!.height).toBeCloseTo(1080, 1);
  }
  if (process.env.REVIEW_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-full-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
  await couch.input({ "202": ["menu"] });
  const gameMenu = page.getByRole("dialog", { name: "Game menu", exact: true });
  await expectSharedMenu(page, gameMenu);
  await expectPlayersPainted(page);
  await expect(
    page.getByRole("complementary", {
      name: "Controller controls",
      exact: true,
    }),
  ).toBeVisible();
  const legend = page.getByRole("complementary", {
    name: "Controller controls",
    exact: true,
  });
  // The native fixture intentionally supplies labels without images. Recognized
  // bindings still need visible icons with their actual accessible origin names.
  for (const name of ["Cross", "Options", "Right stick up", "Right stick down"])
    await expect(legend.getByRole("img", { name, exact: true })).toBeVisible();
  for (const action of ["Game menu", "Pause / resume", "Slower", "Faster"])
    await expect(legend.getByText(action, { exact: true })).toBeVisible();
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "PAUSED");
  await couch.input({ "101": ["build"] });
  await expect(
    p1.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  await expect(gameMenu).toBeVisible();
  if (process.env.REVIEW_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-menu-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
  await couch.input({ "101": ["menu"] });
  await expect(gameMenu).toHaveCount(0);
  await expect(
    page.getByRole("complementary", {
      name: "Controller controls",
      exact: true,
    }),
  ).toHaveCount(0);
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
  await expect(
    p1.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  await expect(
    p2.getByRole("region", { name: "Insights", exact: true }),
  ).toBeVisible();
  await couch.input({ "202": ["menu"] });
  await expect(gameMenu).toBeVisible();
  await expectPlayersPainted(page);
  await pointerTarget(
    page,
    p2,
    clock(p2).getByRole("button", {
      name: "ultra speed",
      exact: true,
      includeHidden: true,
    }),
  );
  // A backdrop click may dismiss the menu; either way the underlying speed never changes.
  await expect(
    clock(p2).getByRole("button", {
      name: "normal speed",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(gameMenu).toHaveCount(0);
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
  await couch.input({ "202": ["menu"] });
  await gameMenu.getByRole("button", { name: "Settings", exact: true }).click();
  const globalSettings = page.getByRole("dialog", {
    name: "Settings",
    exact: true,
  });
  await expect(globalSettings).toBeVisible();
  await expectPlayersPainted(page);
  await expectSharedSettings(globalSettings);
  await expectSettingsClearance(globalSettings);
  await expect(
    page.getByRole("complementary", {
      name: "Controller controls",
      exact: true,
    }),
  ).toBeVisible();
  if (process.env.REVIEW_SCREENSHOT_DIR)
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `couch-settings-${info.project.name}.png`,
      ),
      animations: "disabled",
    });
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "PAUSED");
  await couch.input({ "101": ["build"] });
  await expect(
    p1.getByRole("region", { name: "Build", exact: true, includeHidden: true }),
  ).toHaveCount(0);
  await pointerTarget(
    page,
    p2,
    clock(p2).getByRole("button", {
      name: "ultra speed",
      exact: true,
      includeHidden: true,
    }),
  );
  await expect(globalSettings).toHaveCount(0);
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
  await expect(
    clock(p2).getByRole("button", {
      name: "normal speed",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const closeWith of ["controller", "header"] as const) {
    await couch.input({
      "202": [closeWith === "controller" ? "menuAlt" : "menu"],
    });
    await gameMenu
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await expect(globalSettings).toBeVisible();
    await expect(
      globalSettings.getByRole("complementary", {
        name: "Controller controls",
        exact: true,
      }),
    ).toBeVisible();
    await expectSharedSettings(globalSettings);
    await expectSettingsClearance(globalSettings);
    await expectPlayersPainted(page);
    if (closeWith === "controller") {
      await globalSettings
        .getByRole("button", { name: "System", exact: true })
        .focus();
      await couch.input({ "101": ["back"] });
    } else {
      await globalSettings
        .getByRole("button", { name: "Back", exact: true })
        .click();
    }
    await expect(globalSettings).toHaveCount(0);
    await expect(page.locator(".couchDialogWithControls:visible")).toHaveCount(
      0,
    );
    for (const seat of [p1, p2])
      await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
  }
  await couch.input({ "202": ["menu"] });
  await gameMenu.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(globalSettings).toBeVisible();
  await expect(
    globalSettings.getByRole("complementary", {
      name: "Controller controls",
      exact: true,
    }),
  ).toBeVisible();
  await expectSharedSettings(globalSettings);
  await expectSettingsClearance(globalSettings);
  await expectPlayersPainted(page);
  const appearance = globalSettings.getByRole("group", {
    name: "Appearance",
    exact: true,
  });
  await appearance.getByRole("button", { name: "System", exact: true }).focus();
  await couch.input({ "101": ["right"] });
  await expect(
    appearance.getByRole("button", { name: "Light", exact: true }),
  ).toBeFocused();
  await couch.input({ "202": ["left"] });
  await expect(
    appearance.getByRole("button", { name: "System", exact: true }),
  ).toBeFocused();
  const backdropHash = async () =>
    createHash("sha256")
      .update(
        (await page
          .locator('[data-couch-backdrop-seat="local-p1"]')
          .getAttribute("src")) ?? "",
      )
      .digest("hex");
  const desktopBackdrop = couch.backdropRevision();
  const desktopGeometry = JSON.stringify(couch.layout());
  const interfaceScale = globalSettings.getByRole("combobox", {
    name: "Interface scale",
    exact: true,
  });
  await interfaceScale.selectOption("1.5");
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-scale",
    "1.5",
  );
  await expectSharedSettings(globalSettings);
  await expectSettingsClearance(globalSettings);
  await expectSharedCaptionSize(page, p1, couch.layout()!.zoom);
  if (JSON.stringify(couch.layout()) !== desktopGeometry)
    await expect
      .poll(couch.backdropRevision, {
        message: "changed native bounds refresh the paused player capture",
      })
      .toBeGreaterThan(desktopBackdrop);
  await expectPlayersPainted(page);
  const scaledBackdrop = couch.backdropRevision();
  const scaledGeometry = JSON.stringify(couch.layout());
  await interfaceScale.selectOption("1");
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-scale",
    "1",
  );
  await expectSharedSettings(globalSettings);
  await expectSettingsClearance(globalSettings);
  await expectSharedCaptionSize(page, p1, couch.layout()!.zoom);
  if (JSON.stringify(couch.layout()) !== scaledGeometry)
    await expect.poll(couch.backdropRevision).toBeGreaterThan(scaledBackdrop);
  await expectPlayersPainted(page);
  const previousBackdrop = await backdropHash();
  const originalTheme =
    info.project.use.colorScheme === "dark" ? "dark" : "light";
  const changedTheme = originalTheme === "dark" ? "light" : "dark";
  await globalSettings
    .getByRole("group", { name: "Appearance", exact: true })
    .getByRole("button", {
      name: changedTheme === "dark" ? "Dark" : "Light",
      exact: true,
    })
    .click();
  for (const seat of [p1, p2])
    await expect(seat.locator("html")).toHaveAttribute(
      "data-theme",
      changedTheme,
    );
  await expect
    .poll(backdropHash, {
      message: "paused player capture refreshes with shared appearance",
    })
    .not.toBe(previousBackdrop);
  await expectPlayersPainted(page);
  const changedBackdrop = await backdropHash();
  await globalSettings
    .getByRole("group", { name: "Appearance", exact: true })
    .getByRole("button", { name: "System", exact: true })
    .click();
  for (const seat of [p1, p2])
    await expect(seat.locator("html")).toHaveAttribute(
      "data-theme",
      originalTheme,
    );
  await expect.poll(backdropHash).not.toBe(changedBackdrop);
  await expectPlayersPainted(page);
  await globalSettings
    .getByRole("button", { name: "Back", exact: true })
    .click();
  await expect(globalSettings).toHaveCount(0);
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
});

test("TV couch lost Steam text owner recovers without dismissing newer text", async ({
  context,
  page,
}, info) => {
  test.skip(
    info.project.name !== "tv-1080-light",
    "One authenticated shell event regression covers the owner lifecycle",
  );
  const couch = await createCouchFixture(context, page);
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!;
  const p2 = couch.seats.get("local-p2")!;
  for (const seat of [p1.page, p2.page])
    await expect(seat.locator("#appbar:visible")).toBeVisible();
  await runNormally(p1.page, p2.page);
  const nativeEvent = (detail: Record<string, unknown>) =>
    page.evaluate((event) => {
      window.dispatchEvent(
        new CustomEvent("couchNativeEvent", { detail: event }),
      );
    }, detail);
  const oldText = {
    kind: "global-text",
    id: "old-p1-text",
    seatId: "local-p1",
    generation: p1.generation,
  };
  await nativeEvent({ ...oldText, open: true });
  await expect(
    page.getByRole("heading", {
      name: "P1 Utility: entering text",
      exact: true,
    }),
  ).toBeVisible();
  await nativeEvent({
    kind: "seat-lost",
    seatId: "local-p1",
    generation: p1.generation,
    reason: "Controller seat unavailable",
  });
  await expect.poll(couch.cancelledText).toContain("old-p1-text");
  await expect(
    page.getByRole("heading", {
      name: "P1 Utility: entering text",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "TV session paused", exact: true }),
  ).toBeVisible();
  await nativeEvent({ ...oldText, open: false });
  await expect(
    page.getByRole("heading", { name: "TV session paused", exact: true }),
  ).toBeVisible();
  const newText = {
    kind: "global-text",
    id: "new-p2-text",
    seatId: "local-p2",
    generation: p2.generation,
  };
  await nativeEvent({ ...newText, open: true });
  const newerDialog = page.getByRole("heading", {
    name: "P2 Utility: entering text",
    exact: true,
  });
  await expect(newerDialog).toBeVisible();
  await nativeEvent({ ...oldText, open: false });
  await expect(newerDialog).toBeVisible();
  await nativeEvent({ ...newText, open: false });
  await expect(newerDialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "TV session paused", exact: true }),
  ).toBeVisible();
});

test("TV couch native promise failures return control to the main menu", async ({
  context,
  page,
}, info) => {
  test.skip(
    info.project.name !== "tv-1080-light",
    "Native failure cleanup is independent of palette",
  );
  const couch = await createCouchFixture(context, page);
  await page.goto("/");
  const openSetup = async () => {
    await page
      .getByRole("button", { name: "Play with friends", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Local Co-op", exact: true })
      .click();
    const setup = page.getByRole("dialog", {
      name: "Local Co-op · Two players",
      exact: true,
    });
    await expect(setup).toBeVisible();
    return setup;
  };
  for (const operation of ["setup", "list-saves"] as const) {
    couch.failNextNative(operation);
    const setup = await openSetup();
    await expect(setup.getByRole("alert")).toContainText(
      `Fixture ${operation} failure`,
    );
    await setup.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Play with friends", exact: true }),
    ).toBeVisible();
  }
  const setup = await openSetup();
  couch.failNextNative("close");
  await setup.getByRole("button", { name: "Back", exact: true }).click();
  const failure = page.getByRole("dialog", {
    name: "TV session cleanup failed",
    exact: true,
  });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText("Fixture close failure");
  await expect(
    page.getByRole("heading", {
      name: "Local Co-op · Two players",
      exact: true,
    }),
  ).toHaveCount(0);
  await failure.getByRole("button", { name: "OK", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play with friends", exact: true }),
  ).toBeVisible();
});

test("TV couch coalesces visual preferences without capturing audio changes", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Preference capture behavior in each palette",
  );
  const couch = await createCouchFixture(context, page, { embedded: true });
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  for (const seat of [p1, p2])
    await expect(seat.locator("#appbar:visible")).toBeVisible();
  await runNormally(p1, p2);
  await couch.input({ "202": ["menu"] });
  await page
    .getByRole("dialog", { name: "Game menu", exact: true })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expectSharedSettings(settings);
  await expectPlayersPainted(page);
  await couch.settleCaptures();
  const baselineRefreshes = couch.refreshRequests();
  const baselinePresentations = couch.presentationMessages();
  const sound = settings.getByRole("switch", { name: "Sound", exact: true });
  await sound.check();
  await settings
    .getByRole("slider", { name: "Music volume", exact: true })
    .press("Home");
  await settings
    .getByRole("slider", { name: "Music volume", exact: true })
    .press("ArrowRight");
  await settings
    .getByRole("slider", { name: "Effects volume", exact: true })
    .press("Home");
  await sound.uncheck();
  await expect
    .poll(couch.presentationMessages)
    .toBeGreaterThan(baselinePresentations);
  // Observe the deferred capture window before checking that audio did not
  // schedule a refresh; the native bridge must still receive the preferences.
  await page.waitForTimeout(500);
  await couch.settleCaptures();
  expect
    .soft(
      couch.refreshRequests(),
      "sound and volume preferences do not recapture player screens",
    )
    .toBe(baselineRefreshes);

  const baselineRevision = couch.backdropRevision();
  const beforeVisual = couch.refreshRequests();
  const snapshotHash = async () =>
    createHash("sha256")
      .update(
        (await page
          .locator('[data-couch-backdrop-seat="local-p1"]')
          .getAttribute("src")) ?? "",
      )
      .digest("hex");
  const beforeImage = await snapshotHash();
  const finalTheme = info.project.use.colorScheme === "dark" ? "light" : "dark";
  const finalThemeLabel = finalTheme === "dark" ? "Dark" : "Light";
  const otherThemeLabel = finalTheme === "dark" ? "Light" : "Dark";
  await settings.evaluate(
    (dialog, choices) => {
      const click = (name: string, label: string) => {
        const group = dialog.querySelector(`[aria-label="${name}"]`);
        const button = [
          ...group!.querySelectorAll<HTMLButtonElement>("button"),
        ].find((candidate) => candidate.textContent?.trim() === label);
        if (!button) throw new Error(`Missing ${name}: ${label}`);
        button.click();
      };
      // A burst traverses all visual fields before one paint. Later nonvisual
      // updates must neither trigger screenshots nor cancel the pending visual one.
      click("Appearance", choices.finalThemeLabel);
      const scale = (value: string) => {
        const select = dialog.querySelector<HTMLSelectElement>(
          'select[aria-label="Interface scale"]',
        )!;
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      };
      scale("1");
      click("Units", "Imperial");
      click("Appearance", choices.otherThemeLabel);
      scale("1.25");
      click("Units", "Metric");
      click("Appearance", choices.finalThemeLabel);
      scale("1.5");
      click("Units", "Imperial");
      const audio = dialog.querySelector<HTMLInputElement>(
        'input[aria-label="Sound"]',
      )!;
      audio.click();
      audio.click();
    },
    { finalThemeLabel, otherThemeLabel },
  );
  for (const seat of [p1, p2]) {
    await expect(seat.locator("html")).toHaveAttribute(
      "data-theme",
      finalTheme,
    );
    await expect(seat.locator("html")).toHaveAttribute(
      "data-interface-scale",
      "1.5",
    );
  }
  await expect.poll(couch.refreshRequests).toBeGreaterThan(beforeVisual);
  await expect.poll(couch.backdropRevision).toBeGreaterThan(baselineRevision);
  await expect.poll(snapshotHash).not.toBe(beforeImage);
  await expectPlayersPainted(page);
  await page.waitForTimeout(500);
  await couch.settleCaptures();
  expect
    .soft(
      couch.refreshRequests(),
      "one refresh captures the latest burst, including its final theme and interface scale",
    )
    .toBe(beforeVisual + 1);

  // Units are visual even when they do not change the currently open forecast.
  const beforeUnits = couch.refreshRequests();
  const unitsRevision = couch.backdropRevision();
  await settings
    .getByRole("group", { name: "Units", exact: true })
    .getByRole("button", { name: "Metric", exact: true })
    .click();
  await expect.poll(couch.refreshRequests).toBe(beforeUnits + 1);
  await expect.poll(couch.backdropRevision).toBeGreaterThan(unitsRevision);
  await expectPlayersPainted(page);
  await settings.getByRole("button", { name: "Back", exact: true }).click();
  await expect(settings).toHaveCount(0);
  for (const seat of [p1, p2])
    await expect(clock(seat)).toHaveAttribute("data-active-speed", "NORMAL");
});

for (const committed of [false, true]) {
  test(`TV couch rejected controller binding retries without false ownership (native committed=${committed})`, async ({
    context,
    page,
  }, info) => {
    test.skip(
      !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
      "Binding recovery in both palettes",
    );
    const couch = await createCouchFixture(context, page);
    await page.goto("/");
    const setupReplies = await couch.settledNativeRequests("setup");
    await page
      .getByRole("button", { name: "Play with friends", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Local Co-op", exact: true })
      .click();
    const setup = page.getByRole("dialog", {
      name: "Local Co-op · Two players",
      exact: true,
    });
    await expect(setup).toBeVisible();
    await expect
      .poll(() => couch.settledNativeRequests("setup"))
      .toBe(setupReplies + 1);
    await couch.input({ "202": ["confirm"] });
    await expect(
      setup.getByText("Controller joined", { exact: true }),
    ).toHaveCount(1);
    const nativeBefore = couch.nativeBindings();
    expect(nativeBefore).toEqual({ "local-p1": "202" });
    const pending = couch.deferNextBind(committed);
    await couch.input({ "101": ["confirm"] });
    await pending.requested;
    await expect
      .soft(setup.getByText("Controller joined", { exact: true }))
      .toHaveCount(1);
    await expect
      .soft(setup.getByRole("button", { name: "Choose a game", exact: true }))
      .toBeDisabled();
    await couch.input({ "101": ["confirm"] });
    expect(couch.bindAttempts()).toHaveLength(2);
    pending.settle("reject");
    await expect
      .soft(setup.getByRole("alert"))
      .toHaveText(
        `Error: Fixture bind failure${committed ? ". Native routing changed but recovery did not finish. Press Confirm again." : ""}`,
      );
    await expect
      .soft(setup.getByText("Controller joined", { exact: true }))
      .toHaveCount(1);
    await expect
      .soft(setup.getByRole("button", { name: "Choose a game", exact: true }))
      .toBeDisabled();
    expect(couch.nativeBindings()).toEqual(
      committed ? { ...nativeBefore, "local-p2": "101" } : nativeBefore,
    );
    await couch.input({ "101": ["confirm"] });
    await expect.poll(() => couch.bindAttempts().length).toBe(3);
    await expect(
      setup.getByText("Controller joined", { exact: true }),
    ).toHaveCount(2);
    await expect(
      setup.getByRole("button", { name: "Choose a game", exact: true }),
    ).toBeEnabled();
    expect(couch.nativeBindings()).toEqual({
      "local-p1": "202",
      "local-p2": "101",
    });
  });
}

for (const outcome of ["resolve", "reject"] as const) {
  test(`TV couch stale controller binding ${outcome} cannot affect a new setup`, async ({
    context,
    page,
  }, info) => {
    test.skip(
      info.project.name !== "tv-1080-light",
      "Lifecycle guard is independent of palette",
    );
    const couch = await createCouchFixture(context, page);
    await page.goto("/");
    const open = async () => {
      const replies = await couch.settledNativeRequests("setup");
      await page
        .getByRole("button", { name: "Play with friends", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Local Co-op", exact: true })
        .click();
      const setup = page.getByRole("dialog", {
        name: "Local Co-op · Two players",
        exact: true,
      });
      await expect(setup).toBeVisible();
      await expect
        .poll(() => couch.settledNativeRequests("setup"))
        .toBe(replies + 1);
      return setup;
    };
    const setup = await open();
    const pending = couch.deferNextBind(true);
    await couch.input({ "101": ["confirm"] });
    await pending.requested;
    // The explicit close finishes first; hold the unmount cleanup at its real
    // asynchronous transport boundary while the next setup accepts input.
    const closing = couch.deferNativeClose(2);
    const closeReplies = await couch.settledNativeRequests("close");
    await setup.getByRole("button", { name: "Back", exact: true }).click();
    await closing.requested;
    const newer = await open();
    const fresh = couch.deferNextBind(true);
    await couch.input({ "202": ["confirm"] });
    await fresh.requested;
    expect(couch.nativeBindings()).toEqual({ "local-p1": "202" });
    closing.settle();
    await expect
      .poll(() => couch.settledNativeRequests("close"))
      .toBe(closeReplies + 2);
    expect
      .soft(couch.nativeBindings(), "old close cannot revoke the fresh binding")
      .toEqual({ "local-p1": "202" });
    fresh.settle("resolve");
    await expect(
      newer.getByText("Controller joined", { exact: true }),
    ).toHaveCount(1);
    pending.settle(outcome);
    // The native reply is released before this second real event/frame reaches the shell.
    await couch.input({});
    await expect(newer.getByRole("alert")).toHaveCount(0);
    await expect(
      newer.getByText("Controller joined", { exact: true }),
    ).toHaveCount(1);
    expect(couch.nativeBindings()).toEqual({ "local-p1": "202" });
    await couch.input({ "101": ["confirm"] });
    await expect(
      newer.getByText("Controller joined", { exact: true }),
    ).toHaveCount(2);
    expect(couch.nativeBindings()).toEqual({
      "local-p1": "202",
      "local-p2": "101",
    });
  });
}

test("TV couch play controller binding recovery preserves the other company and renderer blocker", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Live controller recovery in both palettes",
  );
  const couch = await createCouchFixture(context, page);
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  // Native seat creation precedes the shell's final startup reply. Exercise the
  // real menu, whose owner waits for startup, before sending replacement input.
  const gameMenu = page.getByRole("dialog", { name: "Game menu", exact: true });
  await expect
    .poll(async () => {
      if (await gameMenu.isVisible()) return true;
      await couch.input({ "101": ["menu"] });
      return gameMenu.isVisible();
    })
    .toBe(true);
  await gameMenu
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  await expect(gameMenu).toHaveCount(0);
  await couch.setConnected({ "101": false, "303": true });
  const paused = page.getByRole("dialog", {
    name: "TV session paused",
    exact: true,
  });
  await expect(paused).toBeVisible();
  const pending = couch.deferNextBind(true);
  await couch.input({ "303": ["confirm"] });
  await pending.requested;
  await couch.setConnected({ "202": false });
  await expect
    .soft(
      paused.getByText(
        "P1 Utility: controller disconnected. Reconnect its assigned controller.",
        { exact: true },
      ),
    )
    .toBeVisible();
  await expect(
    paused.getByText(
      "P2 Utility: controller disconnected. Reconnect its assigned controller.",
      { exact: true },
    ),
  ).toBeVisible();
  pending.settle("reject");
  await couch.setConnected({ "202": true });
  await expect
    .soft(
      paused.getByText(
        "P1 Utility: controller disconnected. Reconnect its assigned controller.",
        { exact: true },
      ),
    )
    .toBeVisible();
  expect(couch.nativeBindings()).toEqual({
    "local-p1": "303",
    "local-p2": "202",
  });
  await couch.input({ "303": ["confirm"] });
  await expect.poll(() => couch.bindAttempts().length).toBe(4);
  await expect(paused).toHaveCount(0);
  await couch.input({ "303": ["build"] });
  await expect(
    p1.getByRole("region", { name: "Build", exact: true }),
  ).toBeVisible();
  await expect(
    p2.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  await couch.input({ "303": ["back"] });
  await expect(
    p1.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  const lost = couch.seats.get("local-p2")!;
  await page.evaluate(
    ({ generation }) => {
      window.dispatchEvent(
        new CustomEvent("couchNativeEvent", {
          detail: {
            kind: "seat-lost",
            seatId: "local-p2",
            generation,
            reason: "regression route loss",
          },
        }),
      );
    },
    { generation: lost.generation },
  );
  const restoreP2 = paused.getByRole("button", {
    name: "Restore P2 Utility",
    exact: true,
  });
  await expect(restoreP2).toBeVisible();
  couch.failNextNative("reload-seat");
  await restoreP2.click();
  await expect(paused.getByRole("alert")).toContainText(
    "Fixture reload-seat failure",
  );
  await expect(restoreP2).toBeEnabled();
  await couch.setConnected({ "303": false, "404": true });
  await couch.input({ "404": ["confirm"] });
  await expect
    .poll(() => couch.nativeBindings())
    .toEqual({ "local-p1": "404", "local-p2": "202" });
  await expect(
    paused.getByText(
      "P1 Utility: controller disconnected. Reconnect its assigned controller.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(
    paused.getByRole("button", { name: "Restore P2 Utility", exact: true }),
  ).toBeVisible();
});

for (const statusFailure of [false, true]) {
  test(`TV couch retries native-owned P2 after partial reload failure and P1 loss (status unavailable=${statusFailure})`, async ({
    context,
    page,
  }, info) => {
    test.skip(
      !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
      "Real native binding recovery in both palettes",
    );
    const couch = await createCouchFixture(context, page, {
      nativeBindings: true,
    });
    await startCouch(page, couch);
    const gameMenu = page.getByRole("dialog", {
      name: "Game menu",
      exact: true,
    });
    await expect
      .poll(async () => {
        if (await gameMenu.isVisible()) return true;
        await couch.input({ "101": ["menu"] });
        return gameMenu.isVisible();
      })
      .toBe(true);
    await gameMenu
      .getByRole("button", { name: "Return to game", exact: true })
      .click();
    await expect(gameMenu).toHaveCount(0);
    const original = couch.nativeEvidence().topology;
    expect(original["local-p1"].hasPort).toBe(true);
    expect(original["local-p2"].hasPort).toBe(true);
    const statusReplies = await couch.settledNativeRequests("status");
    await couch.setConnected({ "202": false, "404": true });
    couch.failNextNativeReload("local-p2");
    if (statusFailure) couch.failNextNative("status");
    await couch.input({ "404": ["confirm"] });
    await expect
      .poll(() => couch.settledNativeRequests("status"))
      .toBe(statusReplies + 1);
    expect(couch.nativeBindings()).toEqual({
      "local-p1": "101",
      "local-p2": "404",
    });
    const failed = couch.nativeEvidence();
    expect(failed.errors).toEqual(["Error: Fixture native reload failure"]);
    expect(failed.topology["local-p2"].generation).toBeGreaterThan(
      original["local-p2"].generation,
    );
    expect(failed.topology["local-p2"].hasPort).toBe(false);
    const paused = page.getByRole("dialog", {
      name: "TV session paused",
      exact: true,
    });
    await expect(
      paused.getByRole("button", { name: "Restore P2 Utility", exact: true }),
    ).toBeVisible();
    await expect(
      paused.getByText(
        "P2 Utility: controller disconnected. Reconnect its assigned controller.",
        { exact: true },
      ),
    ).toBeVisible();
    await couch.setConnected({ "101": false });
    await expect(
      paused.getByText(
        "P1 Utility: controller disconnected. Reconnect its assigned controller.",
        { exact: true },
      ),
    ).toBeVisible();
    await couch.input({ "404": ["confirm"] });
    await expect
      .poll(() => couch.settledNativeRequests("status"))
      .toBe(statusReplies + 2);
    const expectedErrors = ["Error: Fixture native reload failure"];
    if (statusFailure) {
      // The first status was unavailable, so this attempt discovers ownership
      // through the actual native exclusivity rejection and a recovered status.
      expect(couch.bindAttempts().at(-1)).toEqual({
        seatId: "local-p1",
        controllerId: "404",
      });
      expectedErrors.push(
        "Error: That controller already owns another company",
      );
      expect(couch.nativeEvidence().errors).toEqual(expectedErrors);
      expect(couch.nativeEvidence().topology["local-p2"]).toEqual(
        failed.topology["local-p2"],
      );
      await couch.input({ "404": ["confirm"] });
      await expect
        .poll(() => couch.settledNativeRequests("status"))
        .toBe(statusReplies + 3);
    }
    expect
      .soft(couch.bindAttempts().at(-1))
      .toEqual({ seatId: "local-p2", controllerId: "404" });
    expect(couch.nativeEvidence().errors).toEqual(expectedErrors);
    expect(couch.nativeBindings()).toEqual({
      "local-p1": "101",
      "local-p2": "404",
    });
    await expect(
      paused.getByText(
        "P2 Utility: controller disconnected. Reconnect its assigned controller.",
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(
      paused.getByRole("button", { name: "Restore P2 Utility", exact: true }),
    ).toHaveCount(0);
    await expect(
      paused.getByText(
        "P1 Utility: controller disconnected. Reconnect its assigned controller.",
        { exact: true },
      ),
    ).toBeVisible();
    const recoveredP2 = couch.nativeEvidence().topology["local-p2"];
    expect(recoveredP2.hasPort).toBe(true);
    expect(recoveredP2.generation).toBeGreaterThan(
      failed.topology["local-p2"].generation,
    );
    expect(couch.nativeEvidence().topology["local-p1"]).toEqual(
      original["local-p1"],
    );
    await couch.setConnected({ "303": true });
    await couch.input({ "303": ["confirm"] });
    await expect
      .poll(() => couch.nativeBindings())
      .toEqual({ "local-p1": "303", "local-p2": "404" });
    await expect(paused).toHaveCount(0);
    const p1 = couch.seats.get("local-p1")!.page;
    const p2 = couch.seats.get("local-p2")!.page;
    await couch.input({ "404": ["build"] });
    await expect(
      p2.getByRole("region", { name: "Build", exact: true }),
    ).toBeVisible();
    await expect(
      p1.getByRole("region", { name: "Build", exact: true }),
    ).toHaveCount(0);
    expect(couch.nativeEvidence().topology["local-p2"]).toEqual(recoveredP2);
    expect(couch.nativeEvidence().calls.inputFrame).toBeGreaterThan(0);
    expect(couch.nativeEvidence().calls.bind).toBe(statusFailure ? 6 : 5);
  });
}

test("TV couch keeps controller input usable when one backdrop capture stalls", async ({
  context,
  page,
}, info) => {
  test.skip(
    !["tv-1080-light", "tv-1080-dark"].includes(info.project.name),
    "Bounded native capture behavior in both palettes",
  );
  const couch = await createCouchFixture(context, page, {
    nativeBindings: true,
  });
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  for (const seat of [p1, p2])
    await expect(seat.locator("#appbar:visible")).toBeVisible();
  await couch.settleCaptures();
  const revision = couch.backdropRevision();
  // A real pending font request blocks screenshot preparation in every browser
  // world. Native capture failure must omit only that seat, not trap input.
  let stalledFont: Route | undefined;
  await p1.route("**/couch-capture-stall.woff2", (route) => {
    stalledFont = route;
  });
  await p1.evaluate(() => {
    const font = new FontFace(
      "CouchCaptureStall",
      "url('/couch-capture-stall.woff2')",
    );
    document.fonts.add(font);
    void font.load().catch(() => {});
  });
  await expect.poll(() => !!stalledFont).toBe(true);
  await expect
    .poll(() => p1.evaluate(() => document.fonts.status))
    .toBe("loading");
  try {
    await couch.input({ "101": ["menu"] });
    const menu = page.getByRole("dialog", { name: "Game menu", exact: true });
    await expect(menu).toBeVisible();
    await expect.poll(couch.backdropRevision).toBeGreaterThan(revision);
    await expect(
      page.locator('[data-couch-backdrop-seat="local-p1"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-couch-backdrop-seat="local-p2"]'),
    ).toBeVisible();
    await couch.input({ "101": ["back"] });
    await expect(menu).toHaveCount(0);
    await couch.input({ "202": ["build"] });
    await expect(
      p2.getByRole("region", { name: "Build", exact: true }),
    ).toBeVisible();
    await expect(
      p1.getByRole("region", { name: "Build", exact: true }),
    ).toHaveCount(0);
  } finally {
    await stalledFont?.abort();
  }
});
