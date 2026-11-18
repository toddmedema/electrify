import type { Locator, Page } from "@playwright/test";
import type { MapCanvas } from "../src/components/base/territory-3d/Types";
import { facilityExpansionQuote } from "../src/helpers/FacilityExpansion";
import { currentTick } from "../src/helpers/GameSelectors";
import { territoryTileViews } from "../src/helpers/TerritoryMapState";
import { getTerritoryTile } from "../src/helpers/TerritoryTiles";
import { formatMoneyConcise } from "../src/helpers/Format";
import { loadSimData } from "../src/testing/SimData";
import { expect, test } from "./fixtures";
import { expectDialogToFit } from "./dialog-layout";
import { returnToTerritoryMap, selectTerritoryMapTile } from "./layout";
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

for (const theme of ["light", "dark"] as const) {
  test(`city demand legend and plot share the inspector surface · ${theme}`, async ({
    page,
  }, info) => {
    const map = await start(page, theme);
    await selectTerritoryMapTile(page, getTerritoryTile("champlain:city")!);
    const demand = map.getByRole("region", {
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
    const surface = map.locator(".tileWorkspaceSurface");
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
    await surface
      .getByRole("button", { name: "Close tile", exact: true })
      .click();

    await selectTerritoryMapTile(page, getTerritoryTile(ids.active)!);
    await surface
      .getByRole("button", { name: "Close tile", exact: true })
      .click();
    const active = map.locator(`[data-occupant-tile="${ids.active}"]`);
    await expect(active).toHaveAttribute("data-facility-status", "producing");
    await expect(active.locator(".facilityMapStatusArtwork")).toBeVisible();
    const operation = await sceneFacility(map, ids.active);
    expect(operation).toMatchObject({ active: true, producing: true });
    const selected = map.locator(`[data-map-target="${ids.active}"]`);
    await expect(selected).toHaveAttribute("title", /Generating/);

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
    await expect(status).toBeChecked();
    await expect(layers.getByRole("checkbox")).toHaveCount(1);
    await status.uncheck();
    await expect(active.locator(".facilityMapStatusArtwork")).toHaveCount(0);
    await expect(selected).toHaveAttribute("title", /Generating/);
    expect(await sceneFacility(map, ids.active)).toMatchObject({
      active: true,
      producing: true,
      saturation: operation!.saturation,
    });
    await layers.press("Escape");
    await expect(layers).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(map.locator(".facilityMapStatusArtwork")).toHaveCount(0);
    await selectTerritoryMapTile(page, city);
    await expect(capitalLabel).toHaveCount(0);
    await surface
      .getByRole("button", { name: "Close tile", exact: true })
      .click();
    await selectTerritoryMapTile(page, getTerritoryTile(ids.idle)!);
    const idle = map.locator(`[data-occupant-tile="${ids.idle}"]`);
    await expect(idle).toHaveAttribute("data-facility-status", "idle");
    await expect(idle.locator(".facilityMapStatusArtwork")).toHaveCount(0);
    await surface
      .getByRole("button", { name: "Close tile", exact: true })
      .click();
    await trigger.click();
    await status.check();
    await layers.press("Escape");
    await expect(idle.locator(".facilityMapStatusArtwork")).toBeVisible();
    await selectTerritoryMapTile(page, city);
    await expect(capitalLabel).toBeVisible();
    await surface
      .getByRole("button", { name: "Close tile", exact: true })
      .click();
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
    let map = await continueGame(page);
    const before = (await readSavedGame(page))!;
    const facility = before.facilities.find(
      (facility) => facility.name === "Natural Gas CC",
    )!;
    loadSimData(before.location);
    const targetSize = facility.peakW * 1.25;
    const quote = facilityExpansionQuote(before, facility.id, targetSize);
    expect(quote.status).toBe("ready");
    if (quote.status !== "ready") throw new Error(quote.reason);
    expect(quote.cost).toBeLessThanOrEqual(currentTick(before)!.cash);
    const tile = getTerritoryTile(facility.tileId!)!;
    await selectTerritoryMapTile(page, tile);
    let upgrade = map.getByRole("region", {
      name: "Capacity upgrade",
      exact: true,
    });
    await upgrade
      .getByRole("button", { name: "Upgrade capacity", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: /^Upgrade .* capacity$/ });
    await expectDialogToFit(dialog);
    await dialog
      .getByRole("spinbutton", { name: "New capacity (MW)", exact: true })
      .fill(String(targetSize / 1e6));
    for (const label of [
      "Capacity",
      "Added capital cost",
      "Cash remaining",
      "Construction time",
    ])
      await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    const payment = dialog.getByRole("button", {
      name: `Pay ${formatMoneyConcise(quote.cost)}`,
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
    await map
      .locator(".tileWorkspaceSurface")
      .getByRole("button", { name: "Close tile", exact: true })
      .click();
    const occupant = map.locator(`[data-occupant-tile="${tile.id}"]`);
    await expect(occupant).toHaveAttribute(
      "data-facility-status",
      "construction",
    );
    expect(await sceneFacility(map, tile.id)).toMatchObject({
      active: true,
      producing: true,
    });
    await map.getByRole("button", { name: "Map layers", exact: true }).click();
    const layers = page.getByRole("dialog", {
      name: "Map layers",
      exact: true,
    });
    await layers
      .getByRole("checkbox", { name: "Facility status", exact: true })
      .uncheck();
    await expect(occupant.locator(".facilityMapStatusArtwork")).toHaveCount(0);
    expect(await sceneFacility(map, tile.id)).toMatchObject({
      active: true,
      producing: true,
    });
    await layers.press("Escape");

    map = await continueGame(page);
    await selectTerritoryMapTile(page, tile);
    upgrade = map.getByRole("region", {
      name: "Capacity upgrade",
      exact: true,
    });
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
    await expect(
      upgrade.getByRole("button", { name: "Upgrade capacity", exact: true }),
    ).toBeEnabled();
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
