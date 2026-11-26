import type { Locator, Page } from "@playwright/test";
import { isStorage } from "../src/Types";
import type { MapCanvas } from "../src/components/base/territory-3d/Types";
import { facilityExpansionQuote } from "../src/helpers/FacilityExpansion";
import { currentTick } from "../src/helpers/GameSelectors";
import { territoryTileViews } from "../src/helpers/TerritoryMapState";
import { getTerritoryTile } from "../src/helpers/TerritoryTiles";
import { formatPurchasePrice } from "../src/helpers/Format";
import { loadSimData } from "../src/testing/SimData";
import { expect, test } from "./fixtures";
import { expectDialogToFit } from "./dialog-layout";
import {
  closeTileSurface,
  returnToTerritoryMap,
  selectTerritoryMapTile,
} from "./layout";
import { editSavedGame, readSavedGame } from "./save-fixture";
import { reviewScreenshot } from "./review-screenshot";

// MUI dialogs hide the underlying workspace from accessibility, while its renderer keeps running.
const persistentMap = (page: Page) =>
  page.getByRole("region", {
    name: "Territory map workspace",
    exact: true,
    includeHidden: true,
  });

async function start(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((mode) => {
    localStorage.setItem("theme", mode);
    localStorage.setItem("audioEnabled", "false");
  }, theme);
  await page.goto("/?scenario=116");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const pause = page.getByRole("button", { name: "pause", exact: true });
  await expect(pause).toBeVisible();
  if ((await pause.getAttribute("aria-pressed")) !== "true")
    await pause.click();
  const map = await returnToTerritoryMap(page);
  await expect(map.locator("canvas.territory3DCanvas")).toHaveAttribute(
    "data-renderer",
    "ready",
  );
  await expect(
    page.locator("#appbar:visible [data-save-state]").first(),
  ).toHaveAttribute("data-save-state", "saved");
  return persistentMap(page);
}

async function continueGame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const map = await returnToTerritoryMap(page);
  await expect(map.locator("canvas.territory3DCanvas")).toHaveAttribute(
    "data-renderer",
    "ready",
  );
  return persistentMap(page);
}

async function sceneFacility(map: Locator, tileId: string) {
  return map
    .locator("canvas.territory3DCanvas")
    .evaluate(
      (element: MapCanvas, id) =>
        element.map3DDiagnostics!(true).scene!.find(
          (instance) => instance.id === `structure:${id}`,
        ),
      tileId,
    );
}

const capacityAction = (inspector: Locator) =>
  inspector
    .getByRole("group", { name: "Facility actions" })
    .getByRole("button", { name: "Upgrade capacity", exact: true });

const capacityDialog = (page: Page) =>
  page.getByRole("dialog", { name: /^Upgrade .* capacity\?$/ });

test(
  "capacity review actions remain reachable at the minimum phone width",
  {
    tag: "@minimum-phone",
  },
  async ({ page }, info) => {
    test.skip(info.project.name !== "mobile-360px");
    await start(page, "dark");
    const before = (await readSavedGame(page))!;
    const facility = before.facilities.find(
      ({ name }) => name === "Natural Gas CC",
    )!;
    await selectTerritoryMapTile(page, getTerritoryTile(facility.tileId!)!);
    const upgradeButton = capacityAction(page.locator(".tileWorkspaceSurface"));
    await upgradeButton.click();
    const dialog = capacityDialog(page);
    await expectDialogToFit(dialog);
    const slider = dialog.getByRole("slider", {
      name: "New capacity (MW)",
      exact: true,
    });
    await slider.press("Home");
    await slider.press("ArrowRight");
    await expect(
      dialog.getByText("Added capacity online in", { exact: true }),
    ).toBeVisible();
    const pay = dialog.getByRole("button", { name: "Pay cash", exact: true });
    await expect(pay).toBeInViewport();
    await expect(pay).toBeEnabled();
    await dialog.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(upgradeButton).toBeFocused();
  },
);

test("an inherited gas steam plant submits exhaust only while generating", async ({
  page,
}, info) => {
  await start(page, "light");
  const tileId = await editSavedGame(page, ({ game }) => {
    const facility = game.facilities.find(
      (plant) => plant.name === "Natural Gas CC",
    );
    if (!facility || !facility.tileId || isStorage(facility))
      throw new Error("Expected a mapped gas generator fixture");
    facility.name = "Natural Gas Steam";
    facility.gasCycle = "steam";
    facility.currentW = facility.peakW / 2;
    facility.paused = false;
    return facility.tileId;
  });
  const tile = getTerritoryTile(tileId)!;
  const map = await continueGame(page);
  const target = await selectTerritoryMapTile(page, tile);
  await expect(target).toHaveAccessibleDescription(/Generating/);
  const active = await sceneFacility(map, tileId);
  expect(active).toMatchObject({
    modelKey: "structure:gas-steam:small",
    active: true,
    producing: true,
  });
  const surface = page.locator(".tileWorkspaceSurface");
  await closeTileSurface(surface);
  await reviewScreenshot(map.locator(".territoryMapViewport"), {
    path: info.outputPath("gas-steam-generating.png"),
  });

  await editSavedGame(page, ({ game }) => {
    game.facilities.find((plant) => plant.tileId === tileId)!.currentW = 0;
  });
  await continueGame(page);
  const idleTarget = await selectTerritoryMapTile(page, tile);
  await expect(idleTarget).toHaveAccessibleDescription(/Idle/);
  const idle = await sceneFacility(map, tileId);
  expect(idle).toMatchObject({
    modelKey: "structure:gas-steam:small",
    active: false,
    producing: false,
  });
  expect(active!.triangles).toBeGreaterThan(idle!.triangles);
  await closeTileSurface(surface);
  await reviewScreenshot(map.locator(".territoryMapViewport"), {
    path: info.outputPath("gas-steam-idle.png"),
  });
});

test("the Hydro inspector groups its facility actions and keeps reservoir help", async ({
  page,
  isMobile,
}, info) => {
  await start(page, "light");
  const game = (await readSavedGame(page))!;
  const dam = game.facilities.find((plant) => plant.fuel === "Hydro")!;
  await selectTerritoryMapTile(page, getTerritoryTile(dam.tileId!)!);
  const inspector = page.getByRole("dialog", { name: "Hydro", exact: true });
  const title = inspector.getByRole("heading", { name: "Hydro", exact: true });
  await expect(title.locator("img")).toHaveAttribute(
    "src",
    "/images/hydro.svg",
  );
  await expect(
    inspector.getByRole("heading", { name: "Water", exact: true }),
  ).toBeVisible();
  await expect(
    inspector.getByRole("button", { name: "Water", exact: true }),
  ).toHaveCount(0);
  await expect(
    inspector.getByRole("button", { name: "What is reservoir?" }),
  ).toBeVisible();
  await expect(
    inspector.getByText("Next 12 months", { exact: true }),
  ).toBeVisible();
  const actions = inspector.getByRole("group", { name: "Facility actions" });
  const upgrade = actions.getByRole("button", { name: "Upgrade capacity" });
  await expect(upgrade).toBeDisabled();
  await expect(
    actions.getByRole("button", { name: "Pause Hydro" }),
  ).toBeVisible();
  await expect(
    actions.getByRole("button", { name: "Sell Hydro" }),
  ).toBeVisible();
  await title.evaluate((element) => element.blur());
  await reviewScreenshot(inspector, {
    path: info.outputPath("hydro-inspector.png"),
    scale: "css",
  });
  await actions.scrollIntoViewIfNeeded();
  await reviewScreenshot(inspector, {
    path: info.outputPath("hydro-actions.png"),
    scale: "css",
  });
  if (!isMobile) {
    await page.mouse.move(1, 1);
    await upgrade.hover();
    await expect(page.getByRole("tooltip")).toHaveText(
      "This capacity exceeds the technology or site limit.",
    );
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`city demand legend and plot share the inspector surface · ${theme} @minimum-phone`, async ({
    page,
  }, info) => {
    await start(page, theme);
    await selectTerritoryMapTile(page, getTerritoryTile("champlain:city")!);
    const demand = page.locator(".tileWorkspaceSurface").getByRole("region", {
      name: "City demand by use",
      exact: true,
    });
    const title = demand.getByRole("heading", { name: "Demand by use" });
    const legend = demand.locator(".chartLegend");
    for (const use of [
      "Residential",
      "Commercial",
      "Industrial",
      "Data Centers",
      "Transportation",
    ])
      await expect(legend.getByText(use, { exact: true })).toBeVisible();

    const firstItem = await legend
      .locator(".chartLegendItem")
      .first()
      .boundingBox();
    expect(firstItem?.x).toBeCloseTo((await title.boundingBox())!.x, 1);
    expect(
      await legend.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await expect(demand.locator(".uplot")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await reviewScreenshot(demand, {
      path: info.outputPath(`city-demand-${theme}.png`),
    });
  });

  test(`mixed cities and optional status layers preserve operation · ${theme}`, async ({
    page,
  }, info) => {
    await start(page, theme);
    const ids = await editSavedGame(page, ({ game }) => {
      const active = game.facilities.find(
        (facility) => facility.name === "Natural Gas CC",
      )!;
      const idle = game.facilities.find((facility) => facility.fuel === "Oil")!;
      active.currentW = active.peakW / 2;
      active.paused = false;
      idle.currentW = 0;
      idle.paused = false;
      return { active: active.tileId!, idle: idle.tileId! };
    });
    const map = await continueGame(page);
    const before = (await readSavedGame(page))!;
    const city = territoryTileViews(before).find(
      (view) => view.owned && view.tile.city,
    )!.tile;
    const cityTarget = await selectTerritoryMapTile(page, city);
    const capitalLabel = cityTarget.getByText("Burlington", { exact: true });
    await expect(capitalLabel).toBeVisible();
    const surface = page.locator(".tileWorkspaceSurface");
    await expect(surface).toHaveAccessibleName("Burlington");
    const demand = surface.getByRole("region", {
      name: "City demand by use",
      exact: true,
    });
    for (const use of ["Residential", "Commercial", "Industrial"])
      await expect(demand.getByText(use, { exact: true })).toBeVisible();
    await expect(surface).not.toContainText(/Residential city|Industrial city/);
    await expect
      .poll(async () => (await sceneFacility(map, city.id))?.modelKey)
      .toBe("structure:city-large");
    await closeTileSurface(surface);

    await selectTerritoryMapTile(page, getTerritoryTile(ids.active)!);
    await closeTileSurface(surface);
    // The status layer starts off; the scene still reports operation.
    const active = map.locator(`[data-status-tile="${ids.active}"]`);
    await expect(active).toHaveCount(0);
    const operation = await sceneFacility(map, ids.active);
    expect(operation).toMatchObject({ active: true, producing: true });
    const selected = map.locator(`[data-map-target="${ids.active}"]`);
    await expect(selected).toHaveAccessibleDescription(/Generating/);

    const trigger = map.getByRole("button", {
      name: "Map layers",
      exact: true,
    });
    await trigger.click();
    const layers = page.getByRole("dialog", {
      name: "Map layers",
      exact: true,
    });
    await expectDialogToFit(layers);
    const status = layers.getByRole("checkbox", {
      name: "Facility status",
      exact: true,
    });
    await expect(status).not.toBeChecked();
    const names = layers.getByRole("checkbox", { name: "Names", exact: true });
    await expect(names).toBeChecked();
    await status.check();
    await expect(active).toHaveAttribute("data-facility-status", "producing");
    await expect(active.locator(".facilityMapStatusArtwork")).toBeVisible();
    await expect(selected).toHaveAccessibleDescription(/Generating/);
    expect(await sceneFacility(map, ids.active)).toMatchObject({
      active: true,
      producing: true,
      saturation: operation!.saturation,
    });
    await reviewScreenshot(page, {
      path: info.outputPath(`map-layers-${theme}.png`),
      animations: "disabled",
    });
    await layers.press("Escape");
    await expect(layers).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await selectTerritoryMapTile(page, city);
    await expect(capitalLabel).toBeVisible();
    await expect(cityTarget.getByText("You", { exact: true })).toBeVisible();
    await closeTileSurface(surface);
    await selectTerritoryMapTile(page, getTerritoryTile(ids.idle)!);
    const idle = map.locator(`[data-status-tile="${ids.idle}"]`);
    await expect(idle).toHaveAttribute("data-facility-status", "idle");
    await expect(idle.locator(".facilityMapStatusArtwork")).toBeVisible();
    await closeTileSurface(surface);
    await trigger.click();
    await status.uncheck();
    await names.uncheck();
    await layers.press("Escape");
    await expect(map.locator(".facilityMapStatusArtwork")).toHaveCount(0);
    await selectTerritoryMapTile(page, city);
    await expect(capitalLabel).toHaveCount(0);
    await expect(cityTarget.getByText("You", { exact: true })).toHaveCount(0);
    await closeTileSurface(surface);
    await trigger.click();
    await status.check();
    await names.check();
    await layers.press("Escape");
    await expect(capitalLabel).toBeVisible();
    const after = (await readSavedGame(page))!;
    expect(after.facilities).toEqual(before.facilities);
    expect(currentTick(after)!.cash).toBe(currentTick(before)!.cash);
    await reviewScreenshot(page, {
      path: info.outputPath(`city-status-${theme}.png`),
    });
  });

  test(`upgrade review charges only added capacity, survives reload and refunds cancellation · ${theme}`, async ({
    page,
  }, info) => {
    await start(page, theme);
    await editSavedGame(page, ({ game }) => {
      const facility = game.facilities.find(
        (facility) => facility.name === "Natural Gas CC",
      )!;
      facility.currentW = facility.peakW / 2;
      facility.paused = false;
    });
    const map = await continueGame(page);
    const before = (await readSavedGame(page))!;
    const facility = before.facilities.find(
      (facility) => facility.name === "Natural Gas CC",
    )!;
    loadSimData(before.location);
    const tile = getTerritoryTile(facility.tileId!)!;
    await selectTerritoryMapTile(page, tile);
    const inspector = page.locator(".tileWorkspaceSurface");
    const upgrade = inspector.getByRole("region", {
      name: "Capacity upgrade",
      exact: true,
    });
    const upgradeButton = capacityAction(inspector);
    await expect(upgrade).toHaveCount(0);
    await upgradeButton.scrollIntoViewIfNeeded();
    await reviewScreenshot(inspector, {
      path: info.outputPath(`capacity-offer-${theme}.png`),
      animations: "disabled",
    });
    await upgradeButton.click();
    const dialog = capacityDialog(page);
    await expectDialogToFit(dialog);
    const slider = dialog.getByRole("slider", {
      name: "New capacity (MW)",
      exact: true,
    });
    await slider.press("Home");
    await slider.press("ArrowRight");
    const targetSize = Number(await slider.getAttribute("aria-valuenow")) * 1e6;
    expect(targetSize).toBeGreaterThan(facility.peakW);
    const quote = facilityExpansionQuote(before, facility.id, targetSize);
    if (quote.status !== "ready") throw new Error(quote.reason);
    expect(quote.cost).toBeLessThanOrEqual(currentTick(before)!.cash);
    for (const label of [
      "Cash option",
      "Loan option",
      "Added maintenance",
      "Added capacity online in",
    ])
      await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    await expect(
      dialog.getByText(`${formatPurchasePrice(quote.cost)} now`, {
        exact: true,
      }),
    ).toBeVisible();
    const payment = dialog.getByRole("button", {
      name: "Pay cash",
      exact: true,
    });
    await expect(payment).toBeEnabled();
    expect(currentTick((await readSavedGame(page))!)!.cash).toBe(
      currentTick(before)!.cash,
    );
    await reviewScreenshot(dialog, {
      path: info.outputPath(`capacity-review-${theme}.png`),
    });
    await payment.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      upgrade.getByRole("progressbar", {
        name: "Capacity upgrade construction",
        exact: true,
      }),
    ).toBeVisible();
    const started = (await readSavedGame(page))!;
    const pending = started.facilities.find(({ id }) => id === facility.id)!;
    expect(pending.peakW).toBe(facility.peakW);
    expect(pending.currentW).toBe(facility.currentW);
    expect(pending.expansionInProgress).toMatchObject({
      targetSize,
      quoteKey: quote.quoteKey,
    });
    expect(currentTick(started)!.cash).toBeCloseTo(
      currentTick(before)!.cash - quote.cost,
      3,
    );
    await closeTileSurface(inspector);
    // The status layer starts off; the scene still reports operation.
    const occupant = map.locator(`[data-status-tile="${tile.id}"]`);
    await expect(occupant).toHaveCount(0);
    expect(await sceneFacility(map, tile.id)).toMatchObject({
      active: true,
      producing: true,
    });
    await map.getByRole("button", { name: "Map layers", exact: true }).click();
    const layers = page.getByRole("dialog", {
      name: "Map layers",
      exact: true,
    });
    const status = layers.getByRole("checkbox", {
      name: "Facility status",
      exact: true,
    });
    await expect(status).not.toBeChecked();
    await status.check();
    await expect(occupant).toHaveAttribute(
      "data-facility-status",
      "construction",
    );
    await status.uncheck();
    await expect(occupant.locator(".facilityMapStatusArtwork")).toHaveCount(0);
    expect(await sceneFacility(map, tile.id)).toMatchObject({
      active: true,
      producing: true,
    });
    await layers.press("Escape");

    await continueGame(page);
    await selectTerritoryMapTile(page, tile);
    await expect(
      upgrade.getByRole("progressbar", {
        name: "Capacity upgrade construction",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await readSavedGame(page))!.facilities.find(
        ({ id }) => id === facility.id,
      )!.expansionInProgress,
    ).toEqual(pending.expansionInProgress);
    await upgrade
      .getByRole("button", { name: "Cancel capacity upgrade", exact: true })
      .click();
    const cancel = page.getByRole("dialog", {
      name: "Cancel capacity upgrade?",
      exact: true,
    });
    await expectDialogToFit(cancel);
    await cancel
      .getByRole("button", { name: "Keep building", exact: true })
      .click();
    await expect(upgrade.getByRole("progressbar")).toBeVisible();
    await upgrade
      .getByRole("button", { name: "Cancel capacity upgrade", exact: true })
      .click();
    await cancel
      .getByRole("button", { name: "Cancel upgrade", exact: true })
      .click();
    await expect(cancel).toHaveCount(0);
    await expect(upgrade.getByRole("progressbar")).toHaveCount(0);
    await expect(upgradeButton).toBeFocused();
    await expect(upgradeButton).toBeEnabled();
    const canceled = (await readSavedGame(page))!;
    const retained = canceled.facilities.find(({ id }) => id === facility.id)!;
    expect(retained.expansionInProgress).toBeUndefined();
    expect(retained.peakW).toBe(facility.peakW);
    expect(retained.id).toBe(facility.id);
    expect(currentTick(canceled)!.cash).toBeCloseTo(
      currentTick(before)!.cash,
      3,
    );
  });
}
