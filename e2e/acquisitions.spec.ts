import type { Locator, Page } from "@playwright/test";
import type { GameType } from "../src/Types";
import { TERRITORY_TILES } from "../src/data/TerritoryTiles";
import type { TerritoryTileDefinition } from "../src/data/TerritoryTiles";
import { getBuildFacilityQuote } from "../src/data/Facilities";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../src/helpers/DateTime";
import { currentTick } from "../src/helpers/GameSelectors";
import { formatMoneyConcise } from "../src/helpers/Format";
import { tilePurchaseQuote } from "../src/helpers/Territories";
import {
  getTerritoryTile,
  ownsTerritoryTile,
} from "../src/helpers/TerritoryTiles";
import { loadSimData } from "../src/testing/SimData";
import { territoryTileViews } from "../src/helpers/TerritoryMapState";
import { hexCenter } from "../src/components/base/TerritoryHexGeometry";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { reviewScreenshot } from "./review-screenshot";
import { expectDialogToFit } from "./dialog-layout";
import { editSavedGame, readSavedGame, readSaveRecords } from "./save-fixture";

const tileSurface = (page: Page) => page.locator(".tileWorkspaceSurface");
const mapWorkspace = (page: Page) =>
  page.getByRole("region", { name: "Territory map workspace", exact: true });

async function openMap(page: Page) {
  const facilities = page.locator(".facilities:visible");
  await openPane(
    facilities,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  await facilities
    .getByRole("tab", { name: "Territories", exact: true })
    .click();
  await expect(mapWorkspace(page)).toBeVisible();
  return mapWorkspace(page);
}

async function startMap(page: Page, theme: "light" | "dark") {
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
  return openMap(page);
}

/** Pan the actual camera rather than scrolling a virtualized tile into existence. */
async function panToTile(page: Page, tile: TerritoryTileDefinition) {
  const viewport = mapWorkspace(page).locator(".territoryMapViewport");
  const target = hexCenter(tile);
  for (let attempt = 0; attempt < 20; attempt++) {
    const camera = await viewport.evaluate((element) => ({
      x: Number(element.getAttribute("data-camera-x")),
      y: Number(element.getAttribute("data-camera-y")),
      scale: Number(element.getAttribute("data-camera-scale")),
    }));
    const dx = (camera.x - target.x) * camera.scale;
    const dy = (camera.y - target.y) * camera.scale;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const box = (await viewport.boundingBox())!;
    const step = Math.min(
      1,
      (box.width * 0.3) / Math.max(1, Math.abs(dx)),
      (box.height * 0.25) / Math.max(1, Math.abs(dy)),
    );
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.35;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx * step, y + dy * step, { steps: 4 });
    await page.mouse.up();
  }
  throw new Error(`Could not pan the map to ${tile.id}`);
}

async function inspectTile(page: Page, tile: TerritoryTileDefinition) {
  if (await tileSurface(page).count())
    await tileSurface(page)
      .getByRole("button", { name: "Close tile", exact: true })
      .click();
  await panToTile(page, tile);
  const target = mapWorkspace(page).locator(`[data-map-target="${tile.id}"]`);
  await target.click();
  await expect(target).toHaveAttribute("aria-pressed", "true");
  const surface = tileSurface(page);
  await expect(surface).toBeVisible();
  await expect(surface.locator(".tileWorkspaceHeading h3")).toBeFocused();
  await expectDialogToFit(surface);
  return surface;
}

/** Reach a hidden authored site through real, individual frontier purchases. */
async function revealTile(page: Page, tile: TerritoryTileDefinition) {
  const network = mapWorkspace(page);
  for (let attempt = 0; attempt < 10; attempt++) {
    const game = (await readSavedGame(page))!;
    const views = territoryTileViews(game);
    if (views.some((view) => view.tile.id === tile.id)) {
      const done = network.getByRole("button", {
        name: "Done buying",
        exact: true,
      });
      if (await done.count()) await done.click();
      return;
    }
    const distance = (other: TerritoryTileDefinition) =>
      Math.max(
        Math.abs(other.q - tile.q),
        Math.abs(other.r - tile.r),
        Math.abs(other.q + other.r - tile.q - tile.r),
      );
    const next = views
      .filter(
        (view) => tilePurchaseQuote(game, view.tile.id)?.benefit === "general",
      )
      .sort((a, b) => distance(a.tile) - distance(b.tile))[0]?.tile;
    expect(next, `a purchasable frontier towards ${tile.id}`).toBeDefined();
    await panToTile(page, next);
    const buy = network.getByRole("button", { name: "Buy land", exact: true });
    if (await buy.count()) await buy.click();
    const target = network.locator(`[data-map-target="${next.id}"]`);
    await target.click();
    await expect(target).toHaveAttribute("data-owned", "true");
  }
  throw new Error(`Could not reveal ${tile.id} through the map frontier`);
}

/** Every mounted tile is a truthful subset of the discovered map; offscreen cells are culled. */
async function expectPhysicalMap(network: Locator, game: GameType) {
  const views = territoryTileViews(game);
  const targets = await network
    .locator("button[data-map-target]")
    .evaluateAll((buttons) =>
      buttons.map((button) => ({
        id: button.getAttribute("data-map-target")!,
        territoryId: button.getAttribute("data-territory"),
        terrain: button.getAttribute("data-terrain"),
        owned: button.getAttribute("data-owned"),
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
        x:
          button.getBoundingClientRect().x +
          button.getBoundingClientRect().width / 2,
        y:
          button.getBoundingClientRect().y +
          button.getBoundingClientRect().height / 2,
        selected: button.getAttribute("aria-pressed") === "true",
      })),
    );
  expect(targets.length).toBeGreaterThan(0);
  expect(targets.length).toBeLessThanOrEqual(views.length);
  expect(new Set(targets.map(({ id }) => id)).size).toBe(targets.length);
  const viewport = (await network
    .locator(".territoryMapViewport")
    .boundingBox())!;
  const rendered = new Set(targets.map(({ id }) => id));
  for (const target of targets) {
    const view = views.find(({ tile }) => tile.id === target.id)!;
    expect(view, `discovered tile ${target.id}`).toBeDefined();
    expect(target.territoryId).toBe(view.tile.territoryId);
    expect(target.terrain).toBe(view.tile.terrain);
    expect(target.owned).toBe(String(view.owned));
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    if (!target.selected) {
      expect(target.x).toBeGreaterThanOrEqual(viewport.x - target.width - 1);
      expect(target.x).toBeLessThanOrEqual(
        viewport.x + viewport.width + target.width + 1,
      );
      expect(target.y).toBeGreaterThanOrEqual(viewport.y - target.width - 1);
      expect(target.y).toBeLessThanOrEqual(
        viewport.y + viewport.height + target.width + 1,
      );
    }
    await expect(network.locator(`[data-tile="${target.id}"]`)).toHaveAttribute(
      "data-visibility-distance",
      String(view.visibilityDistance),
    );
  }
  await expect(network.locator(".territoryTerrainArtwork")).toHaveCount(
    targets.length,
  );
  const occupants = await network
    .locator(".territoryTileOccupant")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        id: element.getAttribute("data-occupant-tile"),
        kind: element.getAttribute("data-occupant"),
        distance: element.getAttribute("data-visibility-distance"),
      })),
    );
  expect(occupants.sort((a, b) => a.id!.localeCompare(b.id!))).toEqual(
    views
      .filter(
        (view) =>
          rendered.has(view.tile.id) && (view.tile.city || view.developed),
      )
      .map((view) => ({
        id: view.tile.id,
        kind: view.tile.city
          ? "city"
          : view.facility
            ? view.facility.peakWh !== undefined
              ? "storage"
              : "generator"
            : "tower",
        distance: String(view.visibilityDistance),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
  const wires = await network
    .locator("[data-wire-from][data-wire-to]")
    .evaluateAll((elements) =>
      elements.map((element) =>
        [
          element.getAttribute("data-wire-from"),
          element.getAttribute("data-wire-to"),
        ]
          .sort()
          .join("|"),
      ),
    );
  const mounted = views.filter((view) => rendered.has(view.tile.id));
  const expectedWires = mounted.flatMap((from, index) =>
    mounted
      .slice(index + 1)
      .flatMap((to) =>
        from.developed &&
        to.developed &&
        from.ownerKey === to.ownerKey &&
        Math.max(
          Math.abs(from.tile.q - to.tile.q),
          Math.abs(from.tile.r - to.tile.r),
          Math.abs(from.tile.q + from.tile.r - to.tile.q - to.tile.r),
        ) === 1
          ? [[from.tile.id, to.tile.id].sort().join("|")]
          : [],
      ),
  );
  expect(wires.sort()).toEqual(expectedWires.sort());
  expect(new Set(wires).size).toBe(wires.length);
  for (const wire of wires) {
    const [a, b] = wire
      .split("|")
      .map((id) => views.find(({ tile }) => tile.id === id)!);
    expect(a.developed && b.developed).toBe(true);
    expect(a.ownerKey).toBe(b.ownerKey);
    expect(
      Math.max(
        Math.abs(a.tile.q - b.tile.q),
        Math.abs(a.tile.r - b.tile.r),
        Math.abs(a.tile.q + a.tile.r - b.tile.q - b.tile.r),
      ),
    ).toBe(1);
  }
}

async function expectLockedBuild(surface: Locator) {
  await expect(
    surface.getByRole("tab", { name: "Generators", exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByRole("tab", { name: "Storage", exact: true }),
  ).toBeVisible();
  await expect(
    surface.getByRole("combobox", { name: /^Build (destination|tile)$/ }),
  ).toHaveCount(0);
  await expect(surface).not.toContainText(
    /One building slot|company power pool/,
  );
}

for (const theme of ["light", "dark"] as const) {
  test(`map fills the workspace and opens city charts and plant controls in ${theme}`, async ({
    page,
  }, info) => {
    const network = await startMap(page, theme);
    const before = (await readSavedGame(page))!;
    await expectPhysicalMap(network, before);
    for (const [distance, opacity, saturation] of [
      [1, "0.85", "saturate(0.8)"],
      [2, "0.65", "saturate(0.45)"],
      [3, "0.4", "saturate(0.15)"],
    ] as const) {
      const ground = network
        .locator(`.territoryHex[data-visibility-distance="${distance}"]`)
        .first();
      await expect(ground).toHaveCSS("opacity", opacity);
      await expect(ground).toHaveCSS("filter", saturation);
    }
    await expect(
      network.getByRole("heading", { name: "Territories", exact: true }),
    ).toHaveCount(0);
    await expect(
      network.locator(".territoryMapKey,.territoryHexHub,.territoryParcel"),
    ).toHaveCount(0);
    await expect(network).not.toContainText("company power pool");
    await expect(
      page.getByRole("button", { name: "Build", exact: true }),
    ).toHaveCount(0);
    const dimensions = await network.evaluate((element) => {
      const map = element
        .querySelector(".territoryMapViewport")!
        .getBoundingClientRect();
      const workspace = element
        .closest(".territoryWorkspace")!
        .getBoundingClientRect();
      return {
        map: { width: map.width, height: map.height },
        workspace: { width: workspace.width, height: workspace.height },
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    expect(
      Math.abs(dimensions.map.width - dimensions.workspace.width),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(dimensions.map.height - dimensions.workspace.height),
    ).toBeLessThanOrEqual(1);
    expect(dimensions.overflow).toBeLessThanOrEqual(1);
    await reviewScreenshot(page, {
      path: info.outputPath(`map-workspace-${theme}.png`),
      animations: "disabled",
      scale: "css",
    });
    const discovered = territoryTileViews(before);
    const westernEdge = discovered.reduce((edge, view) =>
      hexCenter(view.tile).x < hexCenter(edge.tile).x ? view : edge,
    );
    await panToTile(page, westernEdge.tile);
    await expectPhysicalMap(network, before);
    expect(
      await network.locator("button[data-map-target]").count(),
    ).toBeLessThan(discovered.length);
    const city = getTerritoryTile("champlain:city", before)!;
    const surface = await inspectTile(page, city);
    await expect(surface).toContainText("Connected customers");
    await expect(surface).toContainText("Current demand");
    const demand = surface.getByRole("region", {
      name: "City demand by use",
      exact: true,
    });
    await expect(demand).toContainText("Demand by use");
    await expect(demand.locator("canvas").first()).toBeVisible();
    await reviewScreenshot(page, {
      path: info.outputPath(`city-workspace-${theme}.png`),
      animations: "disabled",
      scale: "css",
    });
    await surface.locator(".tileWorkspaceHeading h3").press("Escape");
    await expect(surface).toHaveCount(0);
    await expect(
      network.locator(`[data-map-target="${city.id}"]`),
    ).toBeFocused();
    const occupied = territoryTileViews(before).find(
      (view) =>
        view.owned &&
        view.operatingFacility &&
        view.operatingFacility.yearsToBuildLeft === 0,
    )!;
    await inspectTile(page, occupied.tile);
    await expect(surface.locator(".facilityDetails")).toBeVisible();
    await expect(
      surface.getByRole("button", { name: /^(Pause|Resume) / }),
    ).toBeEnabled();
    await expect(surface.getByRole("button", { name: /^Sell / })).toBeEnabled();
    await expect(
      surface.getByRole("button", { name: "Inspect plant", exact: true }),
    ).toHaveCount(0);
    await surface.getByRole("button", { name: /^Pause / }).click();
    expect(
      (await readSavedGame(page))!.facilities.find(
        (facility) => facility.id === occupied.operatingFacility!.id,
      )!.paused,
    ).toBe(true);
    await surface.getByRole("button", { name: /^Resume / }).click();
    expect(
      (await readSavedGame(page))!.facilities.find(
        (facility) => facility.id === occupied.operatingFacility!.id,
      )!.paused,
    ).toBe(false);
    expect(
      (await readSavedGame(page))!.territoryNetwork!.tilePurchases,
    ).toEqual(before.territoryNetwork!.tilePurchases);
  });

  test(`acquires a neighboring utility directly in ${theme}`, async ({
    page,
  }, info) => {
    const network = await startMap(page, theme);
    const initial = (await readSavedGame(page))!;
    const ridge = getTerritoryTile("ridge-electric:city", initial)!;
    const surface = await inspectTile(page, ridge);
    await surface
      .getByRole("button", { name: "Inspect Ridge Electric", exact: true })
      .click();
    const terms = page.getByRole("dialog", {
      name: "Acquisition terms",
      exact: true,
    });
    await expectDialogToFit(terms);
    await expect(terms).toContainText("Assumed debt");
    await terms
      .getByRole("button", { name: "Back to territories", exact: true })
      .click();
    const acquire = surface.getByRole("button", {
      name: "Acquire Ridge Electric",
      exact: true,
    });
    await acquire.click();
    const review = page.getByRole("dialog", {
      name: "Acquire Ridge Electric?",
      exact: true,
    });
    await expectDialogToFit(review);
    await expect(review).toContainText("Inherited debt");
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(review).toHaveCount(0);
    await acquire.click();
    await reviewScreenshot(review, {
      path: info.outputPath(`acquisition-${theme}.png`),
      animations: "disabled",
      scale: "css",
    });
    await review
      .getByRole("button", { name: "Take loan", exact: true })
      .click();
    await expect(review).toHaveCount(0);
    await expect(
      surface.getByRole("button", { name: /^Acquire / }),
    ).toHaveCount(0);
    await expect(
      surface.getByRole("region", { name: "City demand by use", exact: true }),
    ).toBeVisible();
    const saved = (await readSavedGame(page))!;
    expect(
      saved.utilityExpansion!.acquisitions.map((receipt) => receipt.targetId),
    ).toContain("ridge-electric");
    expect(
      saved.facilities.some(
        (facility) => facility.territoryId === "ridge-electric",
      ),
    ).toBe(true);
    expect(
      saved
        .utilityExpansion!.loans.filter(
          (loan) => loan.targetId === "ridge-electric",
        )
        .map((loan) => loan.kind)
        .sort(),
    ).toEqual(["assumed", "purchase"]);
    expect(saved.transmission!.lines).toEqual([]);
    await expectPhysicalMap(network, saved);
    const windTile = territoryTileViews(saved).find(
      (view) =>
        view.tile.territoryId === "ridge-electric" &&
        view.tile.siteKind === "wind" &&
        !view.facility,
    )!.tile;
    await inspectTile(page, windTile);
    await expectLockedBuild(surface);
    await expect(
      surface.getByRole("button", {
        name: "Review purchase of Wind",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      page.getByRole("tab", { name: "Interties", exact: true }),
    ).toHaveCount(0);
  });

  test(`cash buys one tile and its locked generator survives resume in ${theme}`, async ({
    page,
  }, info) => {
    const network = await startMap(page, theme);
    const before = (await readSavedGame(page))!;
    const tile = territoryTileViews(before).find(
      (view) =>
        view.tile.territoryId === "green-uplands" &&
        view.tile.terrain === "hills",
    )!.tile;
    const neighbor = TERRITORY_TILES.find(
      (other) => other.territoryId === tile.territoryId && other.id !== tile.id,
    )!;
    const quote = tilePurchaseQuote(before, tile.id)!;
    const surface = await inspectTile(page, tile);
    await expect(surface).toContainText("Cash after purchase");
    await expect(
      surface.getByRole("button", {
        name: `Buy tile · ${formatMoneyConcise(quote.price)}`,
        exact: true,
      }),
    ).toBeEnabled();
    await surface.getByRole("button", { name: /^Buy tile ·/ }).click();
    await expectLockedBuild(surface);
    const owned = (await readSavedGame(page))!;
    expect(currentTick(owned)!.cash).toBeCloseTo(
      currentTick(before)!.cash - quote.price,
      1,
    );
    expect(currentTick(owned)!.customers).toBe(currentTick(before)!.customers);
    expect(owned.facilities).toHaveLength(before.facilities.length);
    expect(owned.territoryNetwork!.landPurchases).toEqual(
      before.territoryNetwork!.landPurchases,
    );
    expect(owned.territoryNetwork!.tilePurchases).toEqual([
      { tileId: tile.id, minute: owned.date.minute, price: quote.price },
    ]);
    expect(ownsTerritoryTile(owned, tile.id)).toBe(true);
    expect(ownsTerritoryTile(owned, neighbor.id)).toBe(false);
    await reviewScreenshot(page, {
      path: info.outputPath(`tile-build-workspace-${theme}.png`),
      animations: "disabled",
      scale: "css",
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openMap(page);
    await inspectTile(page, tile);
    await expectLockedBuild(surface);
    await surface
      .getByRole("button", { name: "Review purchase of Wind", exact: true })
      .click();
    const review = page.getByRole("dialog", { name: /^Build .* Wind\?/ });
    await expectDialogToFit(review);
    await review.getByRole("button", { name: "Pay cash", exact: true }).click();
    await expect(review).toHaveCount(0);
    const built = (await readSavedGame(page))!;
    const plant = built.facilities.find(
      (facility) => facility.tileId === tile.id,
    )!;
    expect(plant).toEqual(
      expect.objectContaining({
        fuel: "Wind",
        territoryId: tile.territoryId,
        tileId: tile.id,
        peakW: 20e6,
      }),
    );
    loadSimData(owned.location);
    const buildQuote = getBuildFacilityQuote(
      owned,
      plant,
      tile.territoryId,
      tile.id,
    )!;
    expect(currentTick(built)!.cash).toBeCloseTo(
      currentTick(owned)!.cash - buildQuote.buildCost,
      1,
    );
    await expect(surface.locator(".facilityDetails")).toBeVisible();
    await expect(
      surface.getByRole("button", { name: /^Cancel construction of / }),
    ).toBeEnabled();
    await expect(
      surface.getByRole("tab", { name: "Generators", exact: true }),
    ).toHaveCount(0);
    await expectPhysicalMap(network, built);
    await inspectTile(page, neighbor);
    await expect(
      surface.getByRole("button", { name: /^Buy tile ·/ }),
    ).toBeEnabled();
  });

  test(`owned empty tile builds storage at its exact price and location in ${theme}`, async ({
    page,
  }) => {
    await startMap(page, theme);
    await editSavedGame(page, ({ game }) => {
      const minute = 60 * MINUTES_PER_MONTH;
      const offset = minute - game.date.minute;
      game.date = getDateFromMinute(minute, game.startingYear);
      game.objectiveProgress = undefined;
      for (const tick of game.timeline) tick.minute += offset;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const before = (await readSavedGame(page))!;
    const tile = territoryTileViews(before).find(
      (view) =>
        view.owned &&
        !view.facility &&
        view.tile.siteKind === "open-land" &&
        view.tile.terrain === "forest",
    )!.tile;
    await openMap(page);
    const surface = await inspectTile(page, tile);
    await expectLockedBuild(surface);
    await surface.getByRole("tab", { name: "Storage", exact: true }).click();
    await expectLockedBuild(surface);
    await surface.getByRole("slider", { name: /^Capacity/ }).press("Home");
    await surface
      .getByRole("button", {
        name: "Review purchase of Lithium Battery",
        exact: true,
      })
      .click();
    const review = page.getByRole("dialog", {
      name: /^Build .* Lithium Battery\?/,
    });
    await expectDialogToFit(review);
    await review.getByRole("button", { name: "Pay cash", exact: true }).click();
    await expect(review).toHaveCount(0);
    const built = (await readSavedGame(page))!;
    const storage = built.facilities.find(
      (facility) => facility.tileId === tile.id,
    )!;
    expect(storage).toEqual(
      expect.objectContaining({
        name: "Battery",
        territoryId: tile.territoryId,
        tileId: tile.id,
        peakWh: expect.any(Number),
      }),
    );
    loadSimData(before.location);
    const quote = getBuildFacilityQuote(
      before,
      storage,
      tile.territoryId,
      tile.id,
    )!;
    expect(currentTick(built)!.cash).toBeCloseTo(
      currentTick(before)!.cash - quote.buildCost,
      1,
    );
    await expect(surface.locator(".facilityDetails")).toBeVisible();
    await expect(
      surface.getByRole("button", { name: /^Cancel construction of / }),
    ).toBeEnabled();
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    expect(
      (await readSavedGame(page))!.facilities.find(
        (facility) => facility.id === storage.id,
      ),
    ).toEqual(storage);
  });

  test(`rapid buying keeps the camera and mode while navigation cannot spend in ${theme}`, async ({
    page,
  }, info) => {
    const network = await startMap(page, theme);
    const before = (await readSavedGame(page))!;
    const views = territoryTileViews(before);
    const frontier = views.find(
      (view) =>
        view.visibilityDistance === 3 &&
        tilePurchaseQuote(before, view.tile.id)?.benefit === "general",
    )!.tile;
    await panToTile(page, frontier);
    const toggle = network.getByRole("button", {
      name: "Buy land",
      exact: true,
    });
    await toggle.click();
    const done = network.getByRole("button", {
      name: "Done buying",
      exact: true,
    });
    await expect(done).toHaveAttribute("aria-pressed", "true");
    const target = network.locator(`[data-map-target="${frontier.id}"]`);
    await expect(target).toHaveAccessibleName(/Buy .*\$.*General site/);
    const viewport = network.locator(".territoryMapViewport");
    const box = (await target.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
      const session = await page.context().newCDPSession(page);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 6; step++)
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + step * 10, y: y + step * 5 }],
        });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await session.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 60, y + 30, { steps: 6 });
      await page.mouse.up();
    }
    expect(
      (await readSavedGame(page))!.territoryNetwork!.tilePurchases,
    ).toEqual(before.territoryNetwork!.tilePurchases);
    await target.focus();
    await target.press("ArrowRight");
    const focused = network.locator("[data-map-target]:focus");
    await expect(focused).toHaveCount(1);
    expect(await focused.getAttribute("data-map-target")).not.toBe(frontier.id);
    await expect(tileSurface(page)).toHaveCount(0);
    expect(
      (await readSavedGame(page))!.territoryNetwork!.tilePurchases,
    ).toEqual(before.territoryNetwork!.tilePurchases);
    await panToTile(page, frontier);
    const camera = await viewport.evaluate((element) => [
      element.getAttribute("data-camera-x"),
      element.getAttribute("data-camera-y"),
    ]);
    const quote = tilePurchaseQuote(before, frontier.id)!;
    await reviewScreenshot(page, {
      path: info.outputPath(`rapid-buy-${theme}.png`),
      animations: "disabled",
      scale: "css",
    });
    await target.click();
    await expect(target).toHaveAttribute("data-owned", "true");
    await expect(done).toHaveAttribute("aria-pressed", "true");
    await expect(tileSurface(page)).toHaveCount(0);
    expect(
      await viewport.evaluate((element) => [
        element.getAttribute("data-camera-x"),
        element.getAttribute("data-camera-y"),
      ]),
    ).toEqual(camera);
    const bought = (await readSavedGame(page))!;
    expect(currentTick(bought)!.cash).toBeCloseTo(
      currentTick(before)!.cash - quote.price,
      1,
    );
    expect(bought.territoryNetwork!.tilePurchases).toHaveLength(1);
    const revealed = territoryTileViews(bought).filter(
      (view) => !views.some((old) => old.tile.id === view.tile.id),
    );
    expect(revealed.length).toBeGreaterThan(0);
    expect(
      revealed.every(
        (view) => view.visibilityDistance >= 1 && view.visibilityDistance <= 3,
      ),
    ).toBe(true);
    await expect(
      network.locator(`.territoryHex[data-tile="${frontier.id}"]`),
    ).toHaveAttribute("data-visibility-distance", "0");
    await expect(network.getByRole("status")).toContainText("Tile purchased");
    await expect(network.locator(".territoryMapCash")).toHaveText(
      `${formatMoneyConcise(currentTick(bought)!.cash)} available`,
    );
    const next = revealed.find(
      (view) => tilePurchaseQuote(bought, view.tile.id)?.benefit === "general",
    )!.tile;
    await panToTile(page, next);
    const nextTarget = network.locator(`[data-map-target="${next.id}"]`);
    await nextTarget.press("Enter");
    await expect(nextTarget).toHaveAttribute("data-owned", "true");
    await expect(done).toHaveAttribute("aria-pressed", "true");
    expect(
      (await readSavedGame(page))!.territoryNetwork!.tilePurchases,
    ).toHaveLength(2);
    await nextTarget.press("Escape");
    await expect(
      network.getByRole("button", { name: "Buy land", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test(`unaffordable buying remains inspectable without spending in ${theme}`, async ({
    page,
  }) => {
    await startMap(page, theme);
    await editSavedGame(page, ({ game }) => {
      for (const tick of game.timeline) tick.cash = 1;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByRole("button", { name: "Keep current rates", exact: true })
      .click();
    const network = await openMap(page);
    const before = (await readSavedGame(page))!;
    const tile = territoryTileViews(before).find(
      (view) => tilePurchaseQuote(before, view.tile.id)?.benefit === "general",
    )!.tile;
    await panToTile(page, tile);
    await network
      .getByRole("button", { name: "Buy land", exact: true })
      .click();
    const target = network.locator(`[data-map-target="${tile.id}"]`);
    await expect(target).toHaveAccessibleName(
      /Inspect .*not enough available cash/,
    );
    await expect(target).toContainText("Not enough cash");
    await target.click();
    const surface = tileSurface(page);
    await expect(
      surface.getByRole("button", { name: /^Buy tile ·/ }),
    ).toBeDisabled();
    await expect(surface.getByRole("status")).toContainText("more cash needed");
    expect(currentTick((await readSavedGame(page))!)!.cash).toBe(1);
    await surface.locator(".tileWorkspaceHeading h3").press("Escape");
    await expect(surface).toHaveCount(0);
    await expect(target).toBeFocused();
    await expect(
      network.getByRole("button", { name: "Done buying", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  for (const customer of [
    { id: "parcel-1", kind: "residential" },
    { id: "parcel-5", kind: "industrial" },
  ] as const) {
    test(`${customer.kind} tile adds quoted customers without plants in ${theme}`, async ({
      page,
    }) => {
      await startMap(page, theme);
      const tile = TERRITORY_TILES.find(
        (tile) => tile.territoryId === customer.id,
      )!;
      await revealTile(page, tile);
      const before = (await readSavedGame(page))!;
      const quote = tilePurchaseQuote(before, tile.id)!;
      const surface = await inspectTile(page, tile);
      await expect(surface).toContainText(`${customer.kind} customers`);
      await surface.getByRole("button", { name: /^Buy tile ·/ }).click();
      await expect(surface).toContainText("Connected customers");
      await expect(
        surface.getByRole("region", {
          name: "City demand by use",
          exact: true,
        }),
      ).toBeVisible();
      const saved = (await readSavedGame(page))!;
      expect(
        currentTick(saved)!.customers - currentTick(before)!.customers,
      ).toBe(quote.customers);
      expect(currentTick(saved)!.cash).toBeCloseTo(
        currentTick(before)!.cash - quote.price,
        1,
      );
      expect(saved.facilities).toHaveLength(before.facilities.length);
      expect(
        saved.territoryNetwork!.tilePurchases!.map((receipt) => receipt.tileId),
      ).toContain(tile.id);
      await expect(
        surface.getByRole("tab", { name: "Generators", exact: true }),
      ).toHaveCount(0);
    });
  }

  for (const resource of [
    { id: "parcel-7", name: "Hydro", fuel: "Hydro" },
    { id: "parcel-3", name: "Geothermal", fuel: "Geothermal" },
  ] as const) {
    test(`${resource.name} tile unlocks a working locked plant purchase in ${theme}`, async ({
      page,
    }) => {
      await startMap(page, theme);
      const tile = TERRITORY_TILES.find(
        (tile) => tile.territoryId === resource.id,
      )!;
      await revealTile(page, tile);
      const surface = await inspectTile(page, tile);
      await surface.getByRole("button", { name: /^Buy tile ·/ }).click();
      await expectLockedBuild(surface);
      const review = surface.getByRole("button", {
        name: `Review purchase of ${resource.name}`,
        exact: true,
      });
      await expect(review).toBeEnabled();
      await review.click();
      const plant = page.getByRole("dialog", { name: /^Build / });
      await expectDialogToFit(plant);
      await plant
        .getByRole("button", { name: "Take loan", exact: true })
        .click();
      await expect(plant).toHaveCount(0);
      expect((await readSavedGame(page))!.facilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fuel: resource.fuel,
            territoryId: resource.id,
            tileId: tile.id,
          }),
        ]),
      );
    });
  }
}

test("normal valley play saves across the first year and resumes from IndexedDB", async ({
  page,
}) => {
  test.setTimeout(120000);
  await startMap(page, "light");
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await expect
    .poll(async () => (await readSavedGame(page))?.date.monthsElapsed ?? 0, {
      timeout: 60000,
    })
    .toBeGreaterThanOrEqual(13);
  await page.getByRole("button", { name: "pause", exact: true }).click();
  const before = (await readSavedGame(page))!;
  const state = page.locator("#appbar:visible [data-save-state]").first();
  await expect(state).toHaveAttribute("data-save-state", "saved");
  expect(before.monthlyHistory.length).toBeGreaterThanOrEqual(12);
  expect((await readSaveRecords(page))[0].metadata.status).toBe("inProgress");
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const after = (await readSavedGame(page))!;
  expect(after.date.minute).toBeGreaterThanOrEqual(before.date.minute);
  expect(after.monthlyHistory).toEqual(before.monthlyHistory);
  expect(after.transmission?.lines).toEqual(before.transmission?.lines);
  await expect(state).toHaveAttribute("data-save-state", "saved");
  await expect(page.getByText("Save failed", { exact: true })).toHaveCount(0);
});
