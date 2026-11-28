import { expect, test, type Locator, type Page } from "./fixtures";
import { reviewScreenshot } from "./review-screenshot";
import {
  buildTutorialProject,
  startTutorialMission,
  tutorialCoal,
  tutorialMap,
} from "./tutorial-fixture";
import { dragCoalAbovePumpedHydro, dragFleetRowAbove } from "./layout";

const hud = (page: Page) => page.locator(".tutorialHud");
const goal = (page: Page, text: string, timeout?: number) =>
  expect(hud(page).locator(".tutorialHudAction")).toHaveText(text, { timeout });
const nextButton = (page: Page, name = "Next") =>
  hud(page).getByRole("button", { name, exact: true });
const next = (page: Page, name?: string) => nextButton(page, name).click();
const gameAction = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Game actions" })
    .getByRole("button", { name, exact: true });
const action = (page: Page, name: string) => gameAction(page, name).click();
const complete = (page: Page) =>
  expect(page.getByRole("dialog", { name: /Mission complete!/ })).toBeVisible({
    timeout: 35000,
  });

async function setTutorialRate(page: Page, value: string) {
  const rate = page.getByRole("slider", {
    name: "The rate you charge for electricity generation",
    exact: true,
  });
  await rate.fill(value);
}

async function startMission(page: Page, id: number) {
  await startTutorialMission(
    page,
    id,
    test.info().project.use.hasTouch ? "dark" : "light",
  );
  await expect(
    tutorialMap(page).locator("canvas.territory3DCanvas"),
  ).toHaveAttribute("data-renderer", "ready");
}

async function inspectCoal(page: Page) {
  const coal = tutorialMap(page).locator(
    '[data-map-facility="Coal"][data-owned="true"]',
  );
  await coal.click();
  await expect(
    page.getByRole("dialog", { name: "Coal", exact: true }),
  ).toBeVisible();
}

test("Mission 1 · inspect the 3D map, read Fleet and keep a full day supplied", async ({
  page,
}, info) => {
  await startMission(page, 0);
  await goal(page, "Inspect the coal plant on the map");
  await expect(tutorialCoal(page)).toHaveClass(/tutorialTarget/);
  await inspectCoal(page);
  await goal(page, "Open Fleet");
  await reviewScreenshot(page, { path: info.outputPath("map-tutorial.png") });
  await action(page, "Fleet");
  await page.locator("#chartSupplyDemand").click();
  await goal(page, "Start the clock");
  await page.getByRole("button", { name: "slow speed", exact: true }).click();
  await goal(page, "Reach midnight without a blackout");
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await complete(page);
  await page
    .getByRole("button", { name: "Next tutorial", exact: true })
    .click();
  await goal(page, "Build a gas peaker");
});

test("Mission 2 · buy two generators on the map and find construction", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startMission(page, 1);
  await goal(page, "Build a gas peaker");
  await buildTutorialProject(page, "Natural Gas Peaker");
  await goal(page, "Select 1× to watch construction advance");
  const speed = page.getByRole("button", { name: "slow speed", exact: true });
  await expect(speed).toHaveClass(/tutorialTarget/);
  await reviewScreenshot(page, {
    path: test.info().outputPath("tutorial-construction-clock.png"),
    animations: "disabled",
    style: ".snackbar { visibility: hidden; }",
  });
  const clock = page.locator("#appbar [data-game-minute]");
  const before = Number(await clock.getAttribute("data-game-minute"));
  await speed.click();
  await goal(page, "Build a second type of generator");
  await expect
    .poll(async () => Number(await clock.getAttribute("data-game-minute")))
    .toBeGreaterThan(before);
  const pause = page.getByRole("button", { name: "pause", exact: true });
  const inactiveFast = page.getByRole("button", {
    name: "fast speed",
    exact: true,
  });
  await expect(pause.locator("svg")).toHaveCSS(
    "color",
    await inactiveFast
      .locator("svg")
      .evaluate((icon) => getComputedStyle(icon).color),
  );
  await pause.click();
  await buildTutorialProject(page, "Solar");
  await complete(page);
});

test("Mission 3 · move Coal above storage and cover the daily peak with a battery", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startMission(page, 2);
  const touch = await page.evaluate(
    () => matchMedia("(pointer: coarse)").matches,
  );
  // Activate desktop controls by keyboard so the paused setup needs fewer renderer frames.
  const activate = (button: Locator) =>
    touch ? button.click() : button.press("Enter");
  const openMap = tutorialMap(page);
  await goal(page, "Build a battery");
  await buildTutorialProject(page, "Lithium Battery", {
    storage: true,
    openMap,
  });
  await activate(gameAction(page, "Fleet"));
  await goal(page, "Find Pumped Hydro’s charge level");
  await activate(nextButton(page));
  await goal(page, "Move Coal above Pumped Hydro");
  if (touch) {
    await dragCoalAbovePumpedHydro(page);
  } else {
    const handle = page.getByRole("button", {
      name: "Reorder Coal",
      exact: true,
    });
    await handle.press("Space");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Space");
  }
  await expect(hud(page)).toContainText(
    /resets your grid to a single coal plant/i,
  );
  await reviewScreenshot(hud(page), {
    path: test.info().outputPath("tutorial-storage-reset.png"),
    animations: "disabled",
    scale: "css",
  });
  await activate(nextButton(page, "Start final challenge"));
  await goal(page, "Cover peak demand with storage");
  await expect(page.getByTestId("tutorial-target-ring")).toHaveCount(0);
  await buildTutorialProject(page, "Lithium Battery", {
    storage: true,
    size: "19",
    openMap,
  });
  const fast = page.getByRole("button", { name: "fast speed", exact: true });
  if (touch) await fast.click();
  else await page.keyboard.press("3");
  await expect(fast).toHaveAttribute("aria-pressed", "true");
  await complete(page);
});

test("Mission 4 · use Insights and Programs to earn profit", async ({
  page,
}) => {
  await startMission(page, 4);
  await action(page, "Insights");
  await goal(page, "Compare revenue and costs");
  await next(page);
  await action(page, "Programs");
  await setTutorialRate(page, "0.049");
  await goal(page, "Raise the electricity rate");
  const slider = page.locator("#rateSlider");
  const rate = slider.getByRole("slider");
  const max = Number(await rate.getAttribute("max"));
  const bounds = (await slider.boundingBox())!;
  await page.mouse.move(
    bounds.x + (0.06 / max) * bounds.width,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await expect
    .poll(async () => Number(await rate.inputValue()))
    .toBeGreaterThanOrEqual(0.05);
  await goal(page, "Raise the electricity rate");
  await page.mouse.up();
  await goal(page, "Finish the month with a profit");
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await complete(page);
});

test("Mission 5 · use Programs and Insights to attract customers", async ({
  page,
}) => {
  await startMission(page, 3);
  await action(page, "Programs");
  await setTutorialRate(page, "0.061");
  await goal(page, "Set a rate below the market price");
  await setTutorialRate(page, "0.06");
  await goal(page, "Find customer growth in Insights");
  await expect(page.locator("#chartInsightsCustomers")).toBeVisible();
  await next(page);
  await goal(page, "Grow customers 5% while staying profitable");
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await complete(page);
});

test("Mission 6 · read a shortage forecast and finish a new generator", async ({
  page,
}) => {
  test.setTimeout(75000);
  await startMission(page, 5);
  await action(page, "Insights");
  await goal(page, "Find the summer shortage");
  await expect(page.locator("#chartForecastSupplyDemand")).toBeVisible();
  await next(page);
  await goal(page, "Order a plant that can finish before August");
  await buildTutorialProject(page, "Oil", { size: "15" });
  await goal(page, "Keep the lights on through August");
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await goal(page, "Find your plant’s opening in Events", 35000);
  const opening = page
    .locator(".eventLogItem.kind-CONSTRUCTION")
    .filter({ hasText: "Construction complete: Oil" });
  await expect(opening).toBeVisible();
  await expect(opening).toHaveClass(/tutorialTarget/);
  await next(page);
  await complete(page);
});

async function signValleyAgreement(page: Page) {
  await action(page, "Trade");
  const logo = page
    .getByRole("article", { name: "Valley Electric supply", exact: true })
    .locator("[data-utility-logo]");
  await expect(logo).toBeVisible();
  const supplierLogo = await logo.getAttribute("data-utility-logo");
  expect(supplierLogo).toBeTruthy();
  await page
    .getByRole("button", {
      name: "Review Valley Electric supply trade",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "Review Valley Electric supply trade",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept trade", exact: true }).click();
  await goal(page, "Open Fleet to see power flows");
  return supplierLogo;
}

async function openFleetBesideAgreements(page: Page) {
  await action(page, "Fleet");
  // Expose the heading, chart and Close button even after Trade opens.
  const title = page.getByRole("heading", { name: "Fleet", exact: true });
  const box = (await title.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 480, y, { steps: 5 });
  await page.mouse.up();
}

test("closing a tool keeps Trade waiting for Fleet selection", async ({
  page,
}) => {
  await startMission(page, 112);
  const floating = page.viewportSize()!.width >= 1024;
  const fleet = page.getByRole("region", { name: "Fleet", exact: true });
  const agreements = page.getByRole("region", {
    name: "Trade",
    exact: true,
  });
  if (floating) await openFleetBesideAgreements(page);
  await signValleyAgreement(page);
  if (floating) {
    await expect(fleet).toHaveAttribute("data-map-window-front", "false");
    await fleet.getByRole("button", { name: "Close Fleet" }).click();
    await expect(agreements).toHaveAttribute("data-map-window-front", "true");
  } else {
    await agreements.getByRole("button", { name: "Close Trade" }).click();
  }
  await expect(fleet).toHaveCount(0);
  await goal(page, "Open Fleet to see power flows");
  await action(page, "Fleet");
  await goal(page, "Run the clock until your grid imports power");
});

test("selecting Fleet directly displays the trade clock objective", async ({
  page,
}) => {
  await startMission(page, 112);
  const floating = page.viewportSize()!.width >= 1024;
  const fleet = page.getByRole("region", { name: "Fleet", exact: true });
  if (floating) await openFleetBesideAgreements(page);
  await signValleyAgreement(page);
  if (floating) {
    await expect(fleet).toHaveAttribute("data-map-window-front", "false");
    await fleet.getByRole("heading", { name: "Fleet", exact: true }).click();
  } else {
    await gameAction(page, "Fleet").press("Enter");
  }
  await expect(fleet).toHaveAttribute("data-map-window-front", "true");
  await expect(fleet.locator("#chartSupplyDemand")).toBeVisible();
  await goal(page, "Run the clock until your grid imports power");
});

test("an open tile keeps Trade waiting until Fleet is revealed", async ({
  page,
}) => {
  await startMission(page, 112);
  const floating = page.viewportSize()!.width >= 1024;
  const fleet = page.getByRole("region", { name: "Fleet", exact: true });
  const closeAgreements = page.getByRole("button", {
    name: "Close Trade",
    exact: true,
  });
  if (floating) await action(page, "Fleet");
  await signValleyAgreement(page);
  if (!floating) await closeAgreements.click();
  await tutorialMap(page)
    .locator('[data-map-facility="Biomass"][data-owned="true"]')
    .press("Enter");
  const inspector = page.getByRole("dialog", { name: "Biomass", exact: true });
  await expect(inspector).toBeVisible();
  if (floating) {
    await action(page, "Trade");
    await closeAgreements.click();
    await expect(inspector).toHaveAttribute("data-map-window-front", "true");
    await expect(fleet).toHaveAttribute("data-map-window-front", "false");
  }
  await goal(page, "Open Fleet to see power flows");
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  if (!floating) {
    await goal(page, "Open Fleet to see power flows");
    await action(page, "Fleet");
  }
  await expect(fleet).toHaveAttribute("data-map-window-front", "true");
  await goal(page, "Run the clock until your grid imports power");
});

test("a chosen company logo appears at the left of the player's city label @minimum-phone", async ({
  page,
}) => {
  await page.goto("/?scenario=116");
  const picker = page.getByRole("combobox", { name: /Company logo/ });
  await expect(picker).toContainText("Random");
  await expect(picker.getByTestId("QuestionMarkIcon")).toBeVisible();
  await picker.click();
  await expect(page.getByRole("option")).toHaveCount(21);
  await page.getByRole("option", { name: "Sunburst", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();

  const map = tutorialMap(page);
  await expect(map.locator('canvas[data-renderer="ready"]')).toBeVisible();
  const name = map
    .locator('[data-owned="true"] > strong')
    .filter({ hasText: "Burlington" });
  const logo = name.locator('img[data-utility-logo="sunburst"]');
  await expect(logo.first()).toBeVisible();
  await expect
    .poll(() =>
      logo.first().evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  const leftEdges = await name
    .first()
    .evaluate((label) =>
      [...label.children].map((child) => child.getBoundingClientRect().left),
    );
  expect(leftEdges[0]).toBeLessThan(leftEdges[1]);
});

test("Mission 7 · sign a trade and find live imports in Fleet", async ({
  page,
}) => {
  await startMission(page, 112);
  const floating = page.viewportSize()!.width >= 1024;
  const fleet = page.getByRole("region", { name: "Fleet", exact: true });
  if (floating) {
    await action(page, "Fleet");
    await expect(fleet).toHaveAttribute("data-map-window-front", "true");
  }
  const supplierLogo = await signValleyAgreement(page);
  if (floating) {
    await expect(fleet).toHaveAttribute("data-map-window-front", "false");
  } else {
    await expect(fleet).toHaveCount(0);
  }
  await action(page, "Fleet");
  await expect(fleet).toHaveAttribute("data-map-window-front", "true");
  await goal(page, "Run the clock until your grid imports power");
  const agreements = fleet.getByRole("region", {
    name: "Fleet trade",
  });
  const agreementHeading = agreements.locator(".fleetAgreementsHeading");
  const dispatchOrder = agreements.getByRole("list", {
    name: "Trade dispatch order",
  });
  const rows = dispatchOrder.getByRole("listitem");
  await expect(agreementHeading).toBeInViewport();
  await expect(rows).toHaveCount(3);
  await expect(
    agreements.getByRole("button", {
      name: /^Reorder Valley Electric supply,/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#speedChangeButtons")).toHaveClass(
    /tutorialTarget/,
  );
  await expect(page.getByTestId("tutorial-target-ring")).toBeVisible();
  await reviewScreenshot(page, {
    path: test.info().outputPath("tutorial-agreements-clock.png"),
    animations: "disabled",
    scale: "css",
  });
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await goal(page, "Read your trade flows");
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const chart = page.locator("#chartSupplyDemand");
  await expect(
    chart.locator(".chartLegendLabel").getByText("Trade", { exact: true }),
  ).toBeVisible();
  await expect(dispatchOrder).toHaveClass(/tutorialTarget/);
  await expect(agreementHeading).toContainText(
    /Importing [1-9][\d.]*\s*[kMG]?W/,
  );
  const valley = agreements.getByRole("button", {
    name: /^Reorder Valley Electric supply, Importing/,
  });
  await expect(valley).toBeVisible();
  await expect(valley.locator("img")).toHaveAttribute(
    "data-utility-logo",
    supplierLogo!,
  );
  const lastId = (await rows.last().getAttribute("data-rfd-draggable-id"))!;
  const last = rows.and(page.locator(`[data-rfd-draggable-id="${lastId}"]`));
  await expect(last).toBeInViewport({ ratio: 0.9 });
  await expect(rows.first()).toBeInViewport({ ratio: 0.6 });
  await dragFleetRowAbove(
    page,
    last,
    last.getByRole("button"),
    rows.first().getByRole("button"),
  );
  await expect(rows.first()).toHaveAttribute("data-rfd-draggable-id", lastId);
  await expect
    .poll(() =>
      rows
        .first()
        .locator(".outputProgressBar")
        .evaluate((bar) => new DOMMatrix(getComputedStyle(bar).transform).a),
    )
    .toBeGreaterThan(0);
  await reviewScreenshot(agreements, {
    path: test.info().outputPath("fleet-trade-dispatch.png"),
    animations: "disabled",
    scale: "css",
    style: ".snackbar, .tutorialTargetRing { visibility: hidden; }",
  });
  await reviewScreenshot(page, {
    path: test.info().outputPath("tutorial-agreements-fleet.png"),
    animations: "disabled",
    style: ".snackbar { visibility: hidden; }",
  });
  const firstHandle = rows.first().getByRole("button");
  await firstHandle.focus();
  await page.keyboard.press("Space");
  await expect(rows.first()).toHaveClass(/dragging/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(rows.nth(1)).toHaveAttribute("data-rfd-draggable-id", lastId);
  await next(page, "Finish tutorial");
  await complete(page);
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Next tutorial" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Install for later" }),
  ).toHaveCount(0);
});
