import { expect, test } from "./fixtures";
import type { Frame, Page } from "@playwright/test";
import path from "node:path";
import { createCouchFixture } from "./couch-fixture";
import type { CouchFixture } from "./couch-fixture";

async function startCouch<Actor extends Page | Frame>(
  page: Page,
  couch: CouchFixture<Actor>,
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play with friends", exact: true })
    .click();
  await page.getByRole("button", { name: "On this TV", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "On this TV · Two players" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose a game", exact: true }),
  ).toBeDisabled();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect(
    page.getByText("Controller joined", { exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Choose a game", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View Carbon Fee details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start for everyone", exact: true })
    .click();
  const start = page
    .getByRole("dialog")
    .getByRole("button", { name: "Start for everyone", exact: true });
  await expect(start).toBeDisabled();
  await couch.input({ "101": ["confirm"], "202": ["confirm"] });
  await expect.poll(() => couch.seats.size).toBe(2);
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
  const couch = await createCouchFixture(context, page);
  await startCouch(page, couch);
  const p1 = couch.seats.get("local-p1")!.page;
  const p2 = couch.seats.get("local-p2")!.page;
  for (const seat of [p1, p2]) {
    await expect(seat.locator("#appbar:visible")).toBeVisible();
    await expect(seat.locator(".gameStage")).toHaveAttribute(
      "data-layout",
      "tv",
    );
  }
  await expect(page.locator(".appFrameBody")).toBeHidden();
  await expect(speedControls(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "menu", exact: true }),
  ).toHaveCount(1);
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
  const gameMenu = page.getByRole("menu", { name: "Game menu", exact: true });
  await expect(gameMenu).toBeVisible();
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
  await gameMenu
    .getByRole("menuitem", { name: "Settings", exact: true })
    .click();
  const globalSettings = page.getByRole("dialog", {
    name: "P1 Utility: TV session settings",
    exact: true,
  });
  await expect(
    globalSettings.getByRole("heading", {
      name: "P1 Utility: TV session settings",
      exact: true,
    }),
  ).toBeVisible();
  await p2.evaluate(() =>
    window.electrifyCouch!.post({
      kind: "global-settings",
      requestId: "p2-settings",
    }),
  );
  // A competing request keeps the first named owner. The partner's controls are gated.
  await couch.input({ "202": ["build"] });
  await expect(
    globalSettings.getByRole("heading", {
      name: "P1 Utility: TV session settings",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    p2.getByRole("region", { name: "Build", exact: true }),
  ).toHaveCount(0);
  await globalSettings
    .getByRole("button", { name: "Return to all companies", exact: true })
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
  await page
    .getByRole("menu", { name: "Game menu", exact: true })
    .getByRole("menuitem", { name: "Save & Quit", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save & Quit", exact: true })
    .click();
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
  await page.getByRole("button", { name: "On this TV", exact: true }).click();
  await page.getByRole("button", { name: /^Resume Local campaign/ }).click();
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
  await expect(page.locator(".appFrameBody")).toBeHidden();
  await expect(speedControls(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "menu", exact: true }),
  ).toHaveCount(1);
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
  const selectedStyle = await speedControls(p1)
    .getByRole("button", { name: "fast speed", exact: true })
    .evaluate((button) => {
      const probe = document.createElement("span");
      probe.style.color =
        getComputedStyle(button).getPropertyValue("--interactive-blue");
      button.appendChild(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(button).backgroundColor, expected };
    });
  expect(selectedStyle.actual).toBe(selectedStyle.expected);
  await expect
    .poll(() =>
      speedControls(p1)
        .getByRole("button", { name: "normal speed", exact: true })
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
  // The couch daily plot uses 176 design px, 20% below solo's 220. Larger
  // text is already enabled by the real fixture, making its visible height 220 px.
  for (const seat of [p1, p2]) {
    await expect(seat.locator("html")).toHaveAttribute(
      "data-text-size",
      "larger",
    );
    const dailyChart = seat.locator(".facilitySupplyChart .accessibleChart");
    await expect(dailyChart).toBeVisible();
    await expect
      .poll(() =>
        dailyChart.evaluate((chart) => chart.getBoundingClientRect().height),
      )
      .toBe(220);
  }
  await p2.getByRole("button", { name: "Insights", exact: true }).click();
  await expect(p2.locator(".insights:visible .uplot").first()).toBeVisible();
  await p2.locator(".insights:visible .uplot").first().scrollIntoViewIfNeeded();
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
  const gameMenu = page.getByRole("menu", { name: "Game menu", exact: true });
  await expect(gameMenu).toBeVisible();
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
  await couch.input({ "202": ["menu"] });
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
});
