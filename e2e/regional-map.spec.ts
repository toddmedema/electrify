import { expect, type Locator, type Page, test } from "./fixtures";
import { openCustomSetup } from "./layout";
import { reviewScreenshot } from "./review-screenshot";

const regionalMap = (page: Page) =>
  page.getByRole("region", { name: "Regional map workspace", exact: true });

const regionalDock = (page: Page) =>
  page.getByRole("navigation", { name: "Game actions", exact: true });

const vacantSites = (map: Locator) =>
  map.locator(
    '[data-map-target][data-build-site="true"][data-owned="true"]:not([data-map-facility])',
  );

async function startRegionalGame(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const pause = page.getByRole("button", { name: "pause", exact: true });
  await expect(pause).toBeVisible();
  if ((await pause.getAttribute("aria-pressed")) !== "true")
    await pause.click();
  await expect(regionalMap(page)).toBeVisible();
}

test("regional map starts with two connected sites and keeps Fleet and intertie builds reachable", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startRegionalGame(page);
  const map = regionalMap(page);
  const canvas = map.locator("canvas.territory3DCanvas");
  await expect(canvas).toHaveAttribute("data-renderer", "ready");
  await expect(
    map.getByRole("button", { name: "Rapid connection mode" }),
  ).toHaveCount(0);
  await expect(
    map.getByRole("button", { name: "Map layers" }),
  ).toBeInViewport();
  const city = map.getByRole("button", {
    name: "Inspect San Francisco on map",
    exact: true,
  });
  await city.click();
  const cityDetails = page.getByRole("dialog", {
    name: "San Francisco",
    exact: true,
  });
  await expect(cityDetails).toContainText("Illustrative grid");
  await expect(
    cityDetails.getByText("Grid demand", { exact: true }),
  ).toBeVisible();
  await cityDetails.getByRole("button", { name: "Close tile" }).click();
  await expect(cityDetails).toHaveCount(0);
  await expect(city).toBeFocused();

  if (page.viewportSize()!.width >= 1000) {
    const plant = map.locator("[data-map-facility]").first();
    const plantName = (await plant.getAttribute("aria-label"))!
      .replace(/^Inspect /, "")
      .replace(/ on map$/, "");
    await plant.press("Enter");
    const plantDetails = page.getByRole("dialog", {
      name: plantName,
      exact: true,
    });
    await expect(plantDetails.locator(".tileFacilityStatus")).toBeVisible();
    await expect(plantDetails).not.toContainText("Pacific Gas and Electric");
    const pausePlant = plantDetails.getByRole("button", {
      name: `Pause ${plantName}`,
      exact: true,
    });
    await pausePlant.click();
    await plantDetails
      .getByRole("button", { name: `Resume ${plantName}`, exact: true })
      .click();
    await expect(pausePlant).toBeVisible();
    await plantDetails.getByRole("button", { name: "Close tile" }).click();
  }

  const dock = regionalDock(page);
  await dock.getByRole("button", { name: "Fleet", exact: true }).click();
  await expect(
    page.locator("#facilitiesPane #chartSupplyDemand"),
  ).toBeVisible();
  await expect(canvas).toHaveAttribute("data-renderer", "ready");
  await dock.getByRole("button", { name: "Fleet", exact: true }).click();
  await expect(page.locator("#facilitiesPane")).toBeHidden();
  await expect(canvas).toBeVisible();
  const plots = vacantSites(map);
  await expect.poll(() => plots.count()).toBeGreaterThanOrEqual(2);
  await plots.first().press("Enter");
  const site = page.getByRole("dialog").filter({ hasText: "Connected site" });
  await expect(site).toBeVisible();
  await reviewScreenshot(page, {
    path: info.outputPath("connected-opening-site.png"),
    animations: "disabled",
  });
  await site.getByRole("button", { name: "Build", exact: true }).click();
  const build = page.getByRole("region", { name: "Build", exact: true });
  await expect(build).toBeVisible();
  await build.getByRole("tab", { name: "Interties", exact: true }).click();
  await expect(
    build.getByRole("button", {
      name: "Review purchase of Pacific Northwest intertie",
      exact: true,
    }),
  ).toBeVisible();
  await build.getByRole("button", { name: "Close Build", exact: true }).click();
  await expect(map).toBeVisible();
});

test("the regional desktop rail selects a capacity for the real construction review", async ({
  page,
}, { project }) => {
  test.skip(project.use.hasTouch || page.viewportSize()!.width < 1024);
  await startRegionalGame(page);
  const rail = regionalMap(page).getByRole("complementary", {
    name: "Build facilities",
  });
  await expect(rail).toBeVisible();
  await expect(
    regionalDock(page).getByRole("button", { name: "Build", exact: true }),
  ).toHaveCount(0);
  const initial = await rail.boundingBox();
  const map = await regionalMap(page).boundingBox();
  expect(initial!.x).toBeCloseTo(map!.x);

  await rail.getByRole("button", { name: /^Power:/ }).click();
  const sizing = rail.getByRole("slider", { name: "Generator capacity" });
  await sizing.fill("11");
  const power = await sizing.getAttribute("aria-valuetext");
  await sizing.press("Escape");
  await rail.getByRole("button", { name: "Choose Solar", exact: true }).click();
  const build = page.getByRole("region", { name: "Build", exact: true });
  await expect(build).toHaveAttribute("data-resizable", "true");
  await build
    .getByRole("button", { name: "Review purchase of Solar", exact: true })
    .click();
  const purchase = page.getByRole("dialog", { name: `Build ${power} Solar?` });
  await expect(purchase).toBeVisible();
  await purchase
    .getByRole("button", { name: "Take loan", exact: true })
    .click();
  await expect(purchase).toHaveCount(0);
  await expect(build).toBeVisible();

  const buildEntry = rail.getByRole("button", { name: "Build", exact: true });
  await build.getByRole("button", { name: "Close Build", exact: true }).click();
  await page.keyboard.press("Shift+s");
  const storage = build.getByRole("tab", { name: "Storage", exact: true });
  await expect(storage).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(buildEntry).toBeFocused();
  await page.keyboard.press("b");
  await expect(storage).toHaveAttribute("aria-selected", "true");
});

test("regional fleet and map details remain reachable without WebGL2", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      contextId: string,
      options?: unknown,
    ) {
      if (contextId === "webgl2") return null;
      return getContext.call(this, contextId, options);
    } as typeof getContext;
  });
  await startRegionalGame(page);
  const map = regionalMap(page);
  await expect(map.getByRole("status", { name: "3D map" })).toHaveText(
    "The 3D map is unavailable. WebGL2 is required.",
  );
  await map
    .getByRole("button", { name: "Inspect San Francisco on map", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("dialog", { name: "San Francisco", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await regionalDock(page)
    .getByRole("button", { name: "Fleet", exact: true })
    .click();
  await expect(
    page.locator("#facilitiesPane .facilityDisclosure").first(),
  ).toBeVisible();
});

test("a new custom grid starts on the 3D map for the selected city", async ({
  page,
}) => {
  await openCustomSetup(page);
  const start = page.getByRole("button", { name: "Start game", exact: true });
  await expect(start).toBeEnabled();
  const search = page.getByRole("combobox", { name: "Search playable cities" });
  await search.fill("Paris");
  await page
    .getByRole("option", { name: "Paris, France", exact: true })
    .click();
  await expect(start).toBeEnabled();
  await start.click();

  const map = regionalMap(page);
  await expect(map.locator("canvas.territory3DCanvas")).toHaveAttribute(
    "data-renderer",
    "ready",
  );
  await expect(
    map.getByRole("button", { name: "Inspect Paris on map", exact: true }),
  ).toBeVisible();
  await expect.poll(() => vacantSites(map).count()).toBeGreaterThanOrEqual(2);
});

test("map layers align with the desktop dock and clear the flush phone dock", async ({
  page,
}) => {
  await startRegionalGame(page);
  const dock = regionalDock(page);
  const map = regionalMap(page);
  const layers = map.getByRole("button", { name: "Map layers", exact: true });
  await expect(layers).toBeInViewport();

  const bottom = (box: { y: number; height: number }) => box.y + box.height;
  const right = (box: { x: number; width: number }) => box.x + box.width;
  const width = page.viewportSize()!.width;
  const [mapBox, dockBox, layersBox] = await Promise.all([
    map.boundingBox(),
    dock.boundingBox(),
    layers.boundingBox(),
  ]);
  if (width < 700) {
    expect(dockBox!.x).toBeCloseTo(mapBox!.x);
    expect(right(dockBox!)).toBeCloseTo(right(mapBox!));
    expect(dockBox!.y).toBeCloseTo(bottom(mapBox!));
    expect(dockBox!.y - bottom(layersBox!)).toBeGreaterThanOrEqual(8);
    await expect(dock).toHaveCSS("border-top-width", "0px");
    await expect(dock).toHaveCSS("box-shadow", "none");
  } else if (width >= 1024) {
    expect(bottom(layersBox!)).toBeCloseTo(bottom(dockBox!));
    expect(layersBox!.x - right(dockBox!)).toBeGreaterThanOrEqual(8);
  } else {
    expect(dockBox!.y - bottom(layersBox!)).toBeGreaterThanOrEqual(8);
  }
  await layers.click();
  await expect(page.getByRole("dialog", { name: "Map layers" })).toBeVisible();
});
