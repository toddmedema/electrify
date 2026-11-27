import { expect, test, type Locator, type Page } from "./fixtures";
import { reviewScreenshot } from "./review-screenshot";
import {
  buildTutorialProject,
  startTutorialMission,
  tutorialCoal,
  tutorialMap,
} from "./tutorial-fixture";
import { dragCoalAbovePumpedHydro } from "./layout";

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
  await activate(nextButton(page, "Start final challenge"));
  await goal(page, "Cover peak demand with storage");
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

test("Mission 7 · sign an agreement and find live imports in Fleet", async ({
  page,
}) => {
  await startMission(page, 112);
  await action(page, "Agreements");
  await page
    .getByRole("button", {
      name: "Review Valley Electric supply agreement",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "Review Valley Electric supply agreement",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Accept agreement", exact: true })
    .click();
  await goal(page, "Open Fleet to see power flows");
  await action(page, "Fleet");
  await goal(page, "Run the clock until your grid imports power");
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await goal(page, "Find External power on the chart");
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const chart = page.locator("#chartSupplyDemand");
  await expect(
    chart
      .locator(".chartLegendLabel")
      .getByText("External power", { exact: true }),
  ).toBeVisible();
  await reviewScreenshot(page, {
    path: test.info().outputPath("tutorial-agreements-fleet.png"),
    animations: "disabled",
    style: ".snackbar { visibility: hidden; }",
  });
  await next(page, "Finish tutorial");
  await complete(page);
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Next tutorial" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Install for later" }),
  ).toHaveCount(0);
});
