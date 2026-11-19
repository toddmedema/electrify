import { TERRAIN_LABELS } from "../src/data/TerrainLabels";
import type { JSHandle, Locator, Page } from "@playwright/test";
import type { GameType } from "../src/Types";
import type { MapCanvas } from "../src/components/base/territory-3d/Types";
import { TERRITORY_TILES } from "../src/data/TerritoryTiles";
import type { TerritoryTileDefinition } from "../src/data/TerritoryTiles";
import { GENERATORS, getBuildFacilityQuote } from "../src/data/Facilities";
import { TICK_MINUTES } from "../src/Constants";
import { tickState } from "../src/reducers/Game";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../src/helpers/DateTime";
import { currentTick } from "../src/helpers/GameSelectors";
import {
  formatMoneyConcise,
  formatMoneyStable,
  formatPurchasePrice,
  formatWattHours,
} from "../src/helpers/Format";
import {
  purchaseTile,
  tilePurchaseQuote,
  tilePurchaseQuotes,
} from "../src/helpers/Territories";
import {
  availableTerritoryTiles,
  getTerritoryTile,
  isAdjacentToOwnedTerritoryTile,
  ownsTerritoryTile,
  territoryHexDistance,
} from "../src/helpers/TerritoryTiles";
import { getTerrainModifiers } from "../src/helpers/TerrainModifiers";
import { loadSimData } from "../src/testing/SimData";
import { territoryTileViews } from "../src/helpers/TerritoryMapState";
import {
  groundAnchor,
  hexCenter,
} from "../src/components/base/TerritoryHexGeometry";
import { expect, test } from "./fixtures";
import { reviewScreenshot } from "./review-screenshot";
import { expectDialogToFit } from "./dialog-layout";
import {
  readTerritoryMapCamera,
  returnToTerritoryMap,
  selectTerritoryMapTile,
  setMapProjectCapacity,
} from "./layout";
import { editSavedGame, readSavedGame, readSaveRecords } from "./save-fixture";

const tileSurface = (page: Page) => page.locator(".tileWorkspaceSurface");
const mapWorkspace = (page: Page) =>
  page.getByRole("region", { name: "Territory map workspace", exact: true });
const buildRail = (page: Page) =>
  mapWorkspace(page).getByRole("complementary", {
    name: "Build facilities",
    exact: true,
  });

async function openMap(page: Page) {
  return returnToTerritoryMap(page);
}

async function startMap(
  page: Page,
  theme: "light" | "dark",
  simplified = false,
) {
  if (!simplified) await page.emulateMedia({ reducedMotion: "reduce" });
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
  const network = await openMap(page);
  await expect(network.locator("canvas.territory3DCanvas")).toHaveAttribute(
    "data-renderer",
    simplified ? "unavailable" : "ready",
  );
  // The map can render before the asynchronous save session has its first snapshot.
  const saveState = page.locator("#appbar:visible [data-save-state]").first();
  await expect(saveState).toHaveAttribute("data-save-state", "saved");
  await expect(saveState).toHaveAttribute("data-active-save-id", /\S+/);
  const saveId = await saveState.getAttribute("data-active-save-id");
  await expect
    .poll(async () =>
      (await readSaveRecords(page)).some(
        (record) => record.metadata.id === saveId && record.save !== undefined,
      ),
    )
    .toBe(true);
  return network;
}

/** Pan the actual camera rather than scrolling a virtualized tile into existence. */
async function panToTile(
  page: Page,
  tile: Pick<TerritoryTileDefinition, "q" | "r">,
) {
  const viewport = mapWorkspace(page).locator(".territoryMapViewport");
  const target = hexCenter(tile);
  for (let attempt = 0; attempt < 20; attempt++) {
    const camera = await readTerritoryMapCamera(viewport);
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
    // Cross the drag threshold even when the final camera correction is tiny.
    // Return within this gesture so mouseup cannot activate the tile underneath.
    await page.mouse.move(x + 12, y);
    await page.mouse.move(x + dx * step, y + dy * step, { steps: 4 });
    await page.mouse.up();
  }
  throw new Error(`Could not pan the map to ${tile.q},${tile.r}`);
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
  if (
    (await buildRail(page).isVisible()) &&
    (await target.getAttribute("data-owned")) === "true" &&
    (await surface
      .getByRole("heading", { name: TERRAIN_LABELS[tile.terrain], exact: true })
      .count())
  )
    await expect(buildRail(page)).toBeFocused();
  else await expect(surface.locator(".tileWorkspaceHeading h3")).toBeFocused();
  await expectDialogToFit(surface);
  return surface;
}

/** Build the paid approach in the save so the browser can exercise the final connection. */
function connectFrontierToSite(game: GameType, tile: TerritoryTileDefinition) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const quotes = tilePurchaseQuotes(game);
    if (quotes.has(tile.id)) return;
    const next = Array.from(quotes.values())
      .filter((quote) => quote.benefit === "general")
      .map((quote) => ({ quote, tile: getTerritoryTile(quote.tileId)! }))
      .sort(
        (a, b) =>
          territoryHexDistance(a.tile, tile) -
          territoryHexDistance(b.tile, tile),
      )[0];
    expect(next, `a purchasable frontier towards ${tile.id}`).toBeDefined();
    expect(isAdjacentToOwnedTerritoryTile(game, next.tile)).toBe(true);
    expect(
      purchaseTile(game, {
        tileId: next.tile.id,
        quoteKey: next.quote.quoteKey,
      }),
    ).toBe(true);
  }
  throw new Error(
    `Could not connect ${tile.id} through the owned map frontier`,
  );
}

/** Every mounted tile is a truthful subset of the discovered map; offscreen cells are culled. */
async function expectPhysicalMap(network: Locator, game: GameType) {
  const views = territoryTileViews(game);
  // Resize/focus can move the camera between awaits. Compare one physical render.
  const {
    targets,
    viewport,
    artworkCount,
    occupants,
    wires,
    wireShapes,
    scene,
  } = await network.evaluate((element) => {
    const viewport = element
      .querySelector(".territoryMapViewport")!
      .getBoundingClientRect();
    const canvas = element.querySelector<MapCanvas>("canvas.territory3DCanvas");
    const scene =
      canvas?.dataset.renderer === "ready"
        ? canvas.map3DDiagnostics?.(true).scene
        : undefined;
    const connections = scene?.flatMap(
      (instance) => instance.connections ?? [],
    );
    return {
      scene,
      viewport: {
        x: viewport.x,
        y: viewport.y,
        width: viewport.width,
        height: viewport.height,
      },
      artworkCount: element.querySelectorAll(".territoryTerrainArtwork").length,
      targets: Array.from(
        element.querySelectorAll("button[data-map-target]"),
      ).map((button) => ({
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
        distance: scene
          ? String(
              scene.find(
                (instance) =>
                  instance.id ===
                  `terrain:${button.getAttribute("data-map-target")}`,
              )?.fog,
            )
          : element
              .querySelector(
                `[data-tile="${button.getAttribute("data-map-target")}"]`,
              )
              ?.getAttribute("data-visibility-distance"),
      })),
      occupants: Array.from(
        element.querySelectorAll(".territoryTileOccupant"),
      ).map((occupant) => ({
        id: occupant.getAttribute("data-occupant-tile"),
        kind: occupant.getAttribute("data-occupant"),
        distance: occupant.getAttribute("data-visibility-distance"),
      })),
      wireShapes: connections
        ? connections.map((wire) => ({ ...wire, path: null as string | null }))
        : Array.from(
            element.querySelectorAll("[data-wire-from][data-wire-to]"),
          ).map((wire) => ({
            from: wire.getAttribute("data-wire-from")!,
            to: wire.getAttribute("data-wire-to")!,
            kind: wire.getAttribute("data-wire-kind"),
            path: wire.querySelector(".territoryWire")!.getAttribute("d")!,
            start: undefined,
            end: undefined,
            lowY: undefined,
          })),
      wires: connections
        ? connections.map((wire) => [wire.from, wire.to].sort().join("|"))
        : Array.from(
            element.querySelectorAll("[data-wire-from][data-wire-to]"),
          ).map((wire) =>
            [
              wire.getAttribute("data-wire-from"),
              wire.getAttribute("data-wire-to"),
            ]
              .sort()
              .join("|"),
          ),
    };
  });
  expect(targets.length).toBeGreaterThan(0);
  expect(targets.length).toBeLessThanOrEqual(views.length);
  expect(new Set(targets.map(({ id }) => id)).size).toBe(targets.length);
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
      // Artwork needs one hex of padding. The pan buffer allows another quarter
      // hex at the last cull position and a quarter hex of camera travel.
      const padding = 1.5 * target.width + 1;
      expect(target.x).toBeGreaterThanOrEqual(viewport.x - padding);
      expect(target.x).toBeLessThanOrEqual(
        viewport.x + viewport.width + padding,
      );
      expect(target.y).toBeGreaterThanOrEqual(viewport.y - padding);
      expect(target.y).toBeLessThanOrEqual(
        viewport.y + viewport.height + padding,
      );
    }
    expect(target.distance).toBe(String(view.visibilityDistance));
  }
  if (scene) {
    expect(artworkCount).toBe(0);
    const terrain = scene.filter((instance) =>
      instance.id.startsWith("terrain:"),
    );
    expect(terrain.map((instance) => instance.id.slice(8)).sort()).toEqual(
      [...rendered].sort(),
    );
    expect(
      scene
        .filter((instance) => instance.id.startsWith("structure:"))
        .map((instance) => instance.id.slice(10))
        .sort(),
    ).toEqual(occupants.map((occupant) => occupant.id!).sort());
    for (const instance of scene) {
      expect(instance.triangles).toBeGreaterThan(0);
      expect(instance.max[1]).toBeGreaterThan(instance.min[1]);
      if (!instance.id.startsWith("terrain:")) continue;
      const view = views.find(({ tile }) => tile.id === instance.id.slice(8))!;
      expect(instance.modelKey).toMatch(
        new RegExp(`^terrain:${view.tile.terrain}:`),
      );
      expect(instance.fog).toBe(view.visibilityDistance);
      expect(instance.fogMix).toBeCloseTo(
        [0, 0.15, 0.35, 0.6][view.visibilityDistance],
      );
      expect(instance.saturation).toBeCloseTo(
        [1, 0.8, 0.45, 0.15][view.visibilityDistance],
      );
    }
  } else expect(artworkCount).toBe(targets.length);
  expect(occupants.sort((a, b) => a.id!.localeCompare(b.id!))).toEqual(
    views
      .filter(
        (view) =>
          rendered.has(view.tile.id) &&
          (view.tile.city ||
            view.facility ||
            (view.developed &&
              !["lake", "river", "ocean"].includes(view.tile.terrain))),
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
  for (const shape of wireShapes) {
    const from = views.find(({ tile }) => tile.id === shape.from)!;
    const to = views.find(({ tile }) => tile.id === shape.to)!;
    const submerged = [from, to].some(
      (view) =>
        !view.tile.city &&
        !view.facility &&
        ["lake", "river", "ocean"].includes(view.tile.terrain),
    );
    expect(shape.kind).toBe(submerged ? "submerged" : "overhead");
    if (shape.start && shape.end) {
      expect(shape.start.every(Number.isFinite)).toBe(true);
      expect(shape.end.every(Number.isFinite)).toBe(true);
      if (submerged) expect(shape.lowY).toBeCloseTo(0.006);
      else {
        expect(shape.start[1]).toBeGreaterThan(0.1);
        expect(shape.end[1]).toBeGreaterThan(0.1);
        const [startY, endY] = [shape.start[1], shape.end[1]];
        // A steep line can sag below its straight path while still climbing.
        expect(shape.lowY).toBeLessThanOrEqual(Math.min(startY, endY));
        expect(shape.lowY).toBeLessThan((startY + endY) / 2);
        expect(shape.lowY).toBeGreaterThan(0);
      }
    } else if (submerged) {
      expect(shape.path).toContain("L");
    } else {
      expect(shape.path).toContain("Q");
      const points = shape.path!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(points[1], "overhead origin stays above the ground").toBeLessThan(
        groundAnchor(from.tile).y,
      );
      expect(
        points[5],
        "overhead destination stays above the ground",
      ).toBeLessThan(groundAnchor(to.tile).y);
    }
  }
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

async function hasRunningFacilityMotion(art: Locator) {
  return art.evaluate((element) =>
    element
      .getAnimations({ subtree: true })
      .some(
        (animation) => animation.pending || animation.playState === "running",
      ),
  );
}

async function expectHeldFacilityPhase(
  animation: JSHandle<Animation>,
): Promise<number> {
  const { phase, frames } = await animation.evaluate(async (value) => {
    const phase = Number(value.currentTime);
    const frames = [];
    for (let index = 0; index < 3; index++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      frames.push(Number(value.currentTime));
    }
    return { phase, frames };
  });
  for (const sample of frames) expect(sample).toBe(phase);
  return phase;
}

async function expectLockedBuild(surface: Locator) {
  const rail = buildRail(surface.page());
  if (await rail.isVisible()) {
    await expect(
      rail.getByRole("region", { name: "Generator technologies", exact: true }),
    ).toBeVisible();
    await expect(
      rail.getByRole("region", { name: "Storage technologies", exact: true }),
    ).toBeVisible();
  } else {
    await expect(
      surface.getByRole("tab", { name: "Generators", exact: true }),
    ).toBeVisible();
    await expect(
      surface.getByRole("tab", { name: "Storage", exact: true }),
    ).toBeVisible();
  }
  await expect(
    surface.getByRole("combobox", { name: /^Build (destination|tile)$/ }),
  ).toHaveCount(0);
  await expect(surface).not.toContainText(
    /One building slot|company power pool/,
  );
}

/** Keep tile-first purchases on their exact inspected site in both build interfaces. */
async function reviewTileBuild(page: Page, name: string) {
  const surface = tileSurface(page);
  if (await buildRail(page).isVisible()) {
    await buildRail(page)
      .getByRole("button", { name: `Choose sites for ${name}`, exact: true })
      .click();
    await expect(
      surface.getByRole("button", { name: "Cash", exact: true }),
    ).toBeVisible();
    return surface;
  }
  await surface
    .getByRole("button", {
      name: `Review purchase of ${name === "Battery" ? "Lithium Battery" : name}`,
      exact: true,
    })
    .click();
  return page.getByRole("dialog", { name: /^Build / });
}

async function confirmTileBuild(
  page: Page,
  review: Locator,
  tile: TerritoryTileDefinition,
  financed = false,
) {
  const desktop = await buildRail(page).isVisible();
  if (desktop) {
    await review
      .getByRole("button", { name: financed ? "Loan" : "Cash", exact: true })
      .click();
  } else {
    await review
      .getByRole("button", {
        name: financed ? "Take loan" : "Pay cash",
        exact: true,
      })
      .click();
  }
  await expect(review).toHaveCount(0);
  if (desktop) await inspectTile(page, tile);
}

async function expectCityDemand(surface: Locator) {
  const demand = surface.getByRole("region", {
    name: "City demand by use",
    exact: true,
  });
  await expect(
    demand.getByRole("heading", { name: "Demand by use" }),
  ).toBeVisible();
  await expect(demand).toContainText("Residential");
  await expect(demand).toContainText("Industrial");
  await expect(
    demand.getByRole("img", {
      name: /^Chart of predicted electricity demand by customer or use type/,
    }),
  ).toHaveAccessibleName(/latest [1-9]\d*(?:\.\d+)?\s?[kMGT]?W/);
  await expect(demand.locator("canvas").first()).toBeVisible();
}

for (const theme of ["light", "dark"] as const) {
  test(`map persists beneath one right-hand panel in ${theme}`, async ({
    page,
  }, info) => {
    const network = await startMap(page, theme);
    const viewport = network.locator(".territoryMapViewport");
    const original = await viewport.elementHandle();
    await expect(
      page.getByRole("button", { name: "Map", exact: true }),
    ).toHaveCount(0);
    const tools = [
      "Fleet",
      "Agreements",
      "Programs",
      "Insights",
      "Events",
      "Scenario",
    ];
    const widths =
      info.project.name === "desktop-chromium"
        ? [1280, 3840]
        : [page.viewportSize()!.width];
    for (const width of widths) {
      await page.setViewportSize({
        width,
        height: page.viewportSize()!.height,
      });
      await expect
        .poll(() =>
          network.evaluate(
            (element) =>
              element
                .querySelector(".territoryMapViewport")!
                .getBoundingClientRect().width +
              (element
                .querySelector(".desktopBuildRail")
                ?.getBoundingClientRect().width ?? 0),
          ),
        )
        .toBe(width);
      const camera = await readTerritoryMapCamera(viewport);
      for (const name of tools) {
        const trigger = page.getByRole("button", { name, exact: true });
        await trigger.click();
        const panel = page.getByRole("region", { name, exact: true });
        await expect(panel).toBeVisible();
        await expect(page.locator(".gameToolPanel:visible")).toHaveCount(1);
        await expect(panel).toHaveAttribute("data-tool-side", "right");
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        await expect(network).toBeVisible();
        expect(
          await original!.evaluate(
            (element) =>
              element === document.querySelector(".territoryMapViewport"),
          ),
          "the same map stays mounted behind every tool",
        ).toBe(true);
        expect(
          await readTerritoryMapCamera(viewport),
          "opening a tool does not pan or zoom the map",
        ).toEqual(camera);
        const geometry = await panel.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const stage = element.closest(".gameStage")!.getBoundingClientRect();
          const body = element.querySelector(".gameToolBody")!;
          return {
            right: box.right,
            bottom: box.bottom,
            dockTop: document
              .querySelector("#navfooter")!
              .getBoundingClientRect().top,
            rightInset: parseFloat(
              getComputedStyle(element.parentElement!).right,
            ),
            stageRight: stage.right,
            overflow: element.scrollWidth - element.clientWidth,
            bodyOverflow: body.scrollWidth - body.clientWidth,
            pageOverflow: document.documentElement.scrollWidth - innerWidth,
          };
        });
        expect(
          Math.abs(geometry.stageRight - geometry.right - geometry.rightInset),
          "the panel uses its actual right inset, including on compact screens",
        ).toBeLessThanOrEqual(1);
        expect(
          geometry.bottom,
          "panel controls remain above the floating dock",
        ).toBeLessThanOrEqual(geometry.dockTop - 8);
        expect(geometry.overflow).toBeLessThanOrEqual(1);
        expect(geometry.bodyOverflow).toBeLessThanOrEqual(1);
        expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
        if (name === "Fleet") {
          const chart = panel.locator(".facilitySupplyChart");
          await expect(chart.locator("canvas").first()).toBeVisible();
          await expect(
            chart.locator(".chartLegendLabel").first(),
          ).toBeVisible();
          const fit = await panel.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return Array.from(
              element.querySelectorAll(
                ".facilitySupplyChart, .chartLegendLabel, .facilityDisclosure, .facilityDispatchHeader button",
              ),
            )
              .filter((item) => item.getClientRects().length > 0)
              .map((item) => {
                const rect = item.getBoundingClientRect();
                return {
                  text: item.textContent,
                  left: rect.left - box.left,
                  right: rect.right - box.right,
                  overflow: item.scrollWidth - item.clientWidth,
                };
              });
          });
          for (const item of fit) {
            expect(
              item.left,
              `${item.text} stays inside the Fleet panel`,
            ).toBeGreaterThanOrEqual(0);
            expect(
              item.right,
              `${item.text} stays inside the Fleet panel`,
            ).toBeLessThanOrEqual(0);
            expect(
              item.overflow,
              `${item.text} remains fully readable`,
            ).toBeLessThanOrEqual(1);
          }
        }
        if (name === "Fleet" && width === 360)
          await reviewScreenshot(page, {
            path: info.outputPath(`persistent-fleet-${width}-${theme}.png`),
            animations: "disabled",
            scale: "css",
          });
      }
      await page.keyboard.press("Escape");
      await expect(page.locator(".gameToolPanel")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Scenario", exact: true }),
      ).toBeFocused();
      const game = (await readSavedGame(page))!;
      const city = getTerritoryTile("champlain:city", game)!;
      const surface = await inspectTile(page, city);
      await page.getByRole("button", { name: "Fleet", exact: true }).click();
      await expect(surface).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "Fleet", exact: true }),
      ).toBeVisible();
      await returnToTerritoryMap(page);
      await expect(surface).toHaveCount(0);
      if (width >= 700) {
        await panToTile(page, city);
        await page
          .getByRole("button", { name: "Insights", exact: true })
          .click();
        await network.locator(`[data-map-target="${city.id}"]`).click();
        await expect(page.locator(".gameToolPanel")).toHaveCount(0);
        await expect(surface).toBeVisible();
        await surface
          .getByRole("button", { name: "Close tile", exact: true })
          .click();
      }
      await panToTile(page, city);
      const buy = network.getByRole("button", {
        name: "Rapid connection mode",
        exact: true,
      });
      await buy.click();
      await expect(buy).toHaveAttribute("aria-pressed", "true");
      const prices = network.locator(".territoryTilePrice");
      await expect(prices.first()).toBeVisible();
      expect((await prices.allTextContents()).join(" ")).not.toMatch(
        /General site|Not enough cash/,
      );
      if (width === 1280 && theme === "dark")
        await reviewScreenshot(page, {
          path: info.outputPath("persistent-buy-layer-dark.png"),
          animations: "disabled",
          scale: "css",
        });
      await buy.click();
      await expect(buy).toHaveAttribute("aria-pressed", "false");
      expect(
        (await readSavedGame(page))!.territoryNetwork!.tilePurchases,
      ).toEqual(game.territoryNetwork!.tilePurchases);
    }
  });

  test(`simplified map motion follows production and reduced-motion preferences in ${theme}`, async ({
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
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const network = await startMap(page, theme, true);
    await expect(network.locator("canvas.territory3DCanvas")).toHaveAttribute(
      "data-renderer",
      "unavailable",
    );
    const game = (await readSavedGame(page))!;
    const wind = game.facilities.find(
      (facility) => facility.fuel === "Wind" && facility.currentW > 0,
    )!;
    const hydro = game.facilities.find(
      (facility) => facility.fuel === "Hydro" && facility.currentW > 0,
    )!;
    const thermal = game.facilities.find(
      (facility) => facility.fuel === "Natural Gas" && facility.currentW > 0,
    )!;
    expect(wind).toBeDefined();
    expect(hydro).toBeDefined();
    expect(thermal).toBeDefined();
    const art = (id: string) =>
      network.locator(`[data-occupant-tile="${id}"] .territoryOccupantArtwork`);
    await expect(
      page.getByRole("button", { name: "pause", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const surface = await inspectTile(
      page,
      getTerritoryTile(wind.tileId, game)!,
    );
    const windArt = art(wind.tileId!);
    await expect(windArt).toHaveAttribute("data-facility-motion", "active");
    const rotor = windArt.locator(".mapWindRotor");
    const animation = await rotor.evaluateHandle(
      (element) => element.getAnimations()[0],
    );
    await expect
      .poll(() => animation.evaluate((value) => value.playbackRate))
      .toBe(0.25);
    const before = await rotor.evaluate(
      (element) => getComputedStyle(element).transform,
    );
    await expect
      .poll(() =>
        rotor.evaluate((element) => getComputedStyle(element).transform),
      )
      .not.toBe(before);
    await surface.getByRole("button", { name: /^Pause / }).click();
    await expect(windArt).not.toHaveAttribute("data-facility-motion", "active");
    await expect.poll(() => hasRunningFacilityMotion(windArt)).toBe(false);
    const pausedPhase = await expectHeldFacilityPhase(animation);
    expect(
      await rotor.evaluate(
        (element, original) => element.getAnimations()[0] === original,
        animation,
      ),
    ).toBe(true);
    const paused = (await readSavedGame(page))!.facilities.find(
      (facility) => facility.id === wind.id,
    )!;
    expect(paused.paused).toBe(true);
    expect(paused.currentW).toBeGreaterThan(0);
    await surface.getByRole("button", { name: /^Resume / }).click();
    await expect(windArt).toHaveAttribute("data-facility-motion", "active");
    await expect.poll(() => hasRunningFacilityMotion(windArt)).toBe(true);
    expect(
      await rotor.evaluate(
        (element, original) => element.getAnimations()[0] === original,
        animation,
      ),
    ).toBe(true);
    expect(
      await animation.evaluate((value) => Number(value.currentTime)),
    ).toBeGreaterThanOrEqual(pausedPhase);
    await surface
      .getByRole("button", { name: "Close tile", exact: true })
      .click();
    await panToTile(page, getTerritoryTile(thermal.tileId, game)!);
    const thermalArt = art(thermal.tileId!);
    await expect(thermalArt).toHaveAttribute("data-facility-motion", "active");
    await expect(
      thermalArt.locator(".mapFacilityExhaust").first(),
    ).toBeVisible();
    await expect.poll(() => hasRunningFacilityMotion(thermalArt)).toBe(true);
    await expect
      .poll(() =>
        thermalArt
          .locator(".mapFacilityExhaust")
          .evaluateAll((elements) =>
            Math.max(
              ...elements.map((element) =>
                Number(getComputedStyle(element).opacity),
              ),
            ),
          ),
      )
      .toBeGreaterThan(0.5);
    await panToTile(page, getTerritoryTile(hydro.tileId, game)!);
    const hydroArt = art(hydro.tileId!);
    await expect(hydroArt).toHaveAttribute("data-facility-motion", "active");
    await expect(hydroArt.locator(".mapHydroFlow")).toBeVisible();
    await expect.poll(() => hasRunningFacilityMotion(hydroArt)).toBe(true);
    const flowPart = hydroArt.locator(".mapHydroFlow");
    const flow = await flowPart.evaluateHandle(
      (element) => element.getAnimations()[0],
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(hydroArt).not.toHaveAttribute(
      "data-facility-motion",
      "active",
    );
    await expect.poll(() => hasRunningFacilityMotion(hydroArt)).toBe(false);
    const reducedPhase = await expectHeldFacilityPhase(flow);
    await expect(
      network.locator(`[data-occupant-tile="${hydro.tileId}"]`),
    ).toHaveAttribute("data-facility-status", "producing");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(hydroArt).toHaveAttribute("data-facility-motion", "active");
    await expect.poll(() => hasRunningFacilityMotion(hydroArt)).toBe(true);
    expect(
      await hydroArt
        .locator(".mapHydroFlow")
        .evaluate(
          (element, original) => element.getAnimations()[0] === original,
          flow,
        ),
    ).toBe(true);
    expect(
      await flow.evaluate((value) => Number(value.currentTime)),
    ).toBeGreaterThanOrEqual(reducedPhase);

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => hasRunningFacilityMotion(hydroArt)).toBe(false);
    const hiddenPhase = await expectHeldFacilityPhase(flow);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => hasRunningFacilityMotion(hydroArt)).toBe(true);
    expect(
      await hydroArt
        .locator(".mapHydroFlow")
        .evaluate(
          (element, original) => element.getAnimations()[0] === original,
          flow,
        ),
    ).toBe(true);
    expect(
      await flow.evaluate((value) => Number(value.currentTime)),
    ).toBeGreaterThanOrEqual(hiddenPhase);
    const foreign = territoryTileViews(game).find(
      (view) => !view.owned && view.facility,
    )!;
    expect(foreign).toBeDefined();
    await panToTile(page, foreign.tile);
    await expect(art(foreign.tile.id)).toBeVisible();
    await expect(art(foreign.tile.id)).not.toHaveAttribute(
      "data-facility-motion",
      "active",
    );
    await expect
      .poll(() => hasRunningFacilityMotion(art(foreign.tile.id)))
      .toBe(false);
    // Let the real game clock advance only after checking the initial production snapshot.
    await panToTile(page, getTerritoryTile(wind.tileId, game)!);
    const rateAnimation = await rotor.evaluateHandle(
      (element) => element.getAnimations()[0],
    );
    for (const [label, rate] of [
      ["slow speed", 0.7],
      ["normal speed", 1],
      ["fast speed", 1.2],
      ["ultra speed", 1.5],
      ["pause", 0.25],
    ] as const) {
      const control = page.getByRole("button", { name: label, exact: true });
      if (!(await control.count())) continue; // 24× is desktop only.
      const phase = await rateAnimation.evaluate((value) =>
        Number(value.currentTime),
      );
      await control.click();
      await expect
        .poll(() => rateAnimation.evaluate((value) => value.playbackRate))
        .toBe(rate);
      expect(
        await rotor.evaluate(
          (element, original) => element.getAnimations()[0] === original,
          rateAnimation,
        ),
      ).toBe(true);
      expect(
        await rateAnimation.evaluate((value) => Number(value.currentTime)),
      ).toBeGreaterThanOrEqual(phase);
      expect(
        await rateAnimation.evaluate(
          (value) => value.effect!.getTiming().duration,
        ),
      ).toBe(14000);
    }
  });

  test(`map facility states follow actual operation, pause and construction in ${theme}`, async ({
    page,
  }, info) => {
    const network = await startMap(page, theme);
    const before = (await readSavedGame(page))!;
    const hydro = before.facilities.find(
      (facility) => facility.startingAssetId === "scenario-116-champlain-hydro",
    )!;
    const oil = before.facilities.find(
      (facility) => facility.startingAssetId === "scenario-116-champlain-oil-a",
    )!;
    const biomass = before.facilities.find(
      (facility) =>
        facility.startingAssetId === "scenario-116-champlain-biomass",
    )!;
    expect(hydro.currentW).toBeGreaterThan(0);
    expect(oil.currentW).toBe(0);
    expect(!!oil.paused).toBe(false);
    const surface = await inspectTile(
      page,
      getTerritoryTile(hydro.tileId, before)!,
    );
    await expect(surface.locator(".tileFacilityStatus")).toHaveText(
      /^Generating ·/,
    );
    await inspectTile(page, getTerritoryTile(oil.tileId, before)!);
    await expect(surface.locator(".tileFacilityStatus")).toHaveText(
      /^Idle · 0\//,
    );
    await inspectTile(page, getTerritoryTile(biomass.tileId, before)!);
    await surface.getByRole("button", { name: /^Pause / }).click();
    await expect(surface.locator(".tileFacilityStatus")).toHaveText(
      /^Operation paused ·/,
    );
    const paused = (await readSavedGame(page))!;
    expect(
      paused.facilities.find((facility) => facility.id === biomass.id)!.paused,
    ).toBe(true);
    expect(
      paused.facilities.find((facility) => facility.id === biomass.id)!
        .currentW,
    ).toBe(biomass.currentW);

    loadSimData(paused.location);
    const wind = GENERATORS(paused, 20e6, [], []).find(
      (item) => item.name === "Wind",
    )!;
    const hydroTile = getTerritoryTile(hydro.tileId, paused)!;
    const site = [...availableTerritoryTiles(paused, wind, "champlain")]
      .filter((tile) => tile.siteKind === "wind")
      .sort(
        (a, b) =>
          territoryHexDistance(a, hydroTile) -
          territoryHexDistance(b, hydroTile),
      )[0];
    expect(site).toBeDefined();
    await inspectTile(page, site);
    const review = await reviewTileBuild(page, "Wind");
    await confirmTileBuild(page, review, site);
    await expect(surface.locator(".tileFacilityStatus")).toHaveText(
      /^Under construction ·/,
    );
    const built = (await readSavedGame(page))!;
    const plant = built.facilities.find(
      (facility) => facility.tileId === site.id,
    )!;
    expect(plant.peakW).toBe(20e6);
    expect(plant.yearsToBuildLeft).toBeGreaterThan(0);
    expect(plant.currentW).toBe(0);
    expect(!!plant.paused).toBe(false);
    await surface
      .getByRole("button", { name: "Close tile", exact: true })
      .click();
    await expect(surface).toHaveCount(0);
    await expect(
      network.locator('[data-map-target][aria-pressed="true"]'),
    ).toHaveCount(0);
    const dismiss = page.getByRole("button", {
      name: "Dismiss notification",
      exact: true,
    });
    if (await dismiss.isVisible()) await dismiss.click();
    await expect(page.locator(".MuiSnackbar-root")).toHaveCount(0);

    const states = [
      [getTerritoryTile(hydro.tileId, built)!, "producing", "Generating"],
      [getTerritoryTile(oil.tileId, built)!, "idle", "Idle"],
      [getTerritoryTile(biomass.tileId, built)!, "paused", "Operation paused"],
      [site, "construction", "Under construction"],
    ] as const;
    const centers = states.map(([tile]) => hexCenter(tile));
    await panToTile(page, {
      q:
        (Math.min(...states.map(([tile]) => tile.q)) +
          Math.max(...states.map(([tile]) => tile.q))) /
        2,
      r:
        (Math.min(...states.map(([tile]) => tile.r)) +
          Math.max(...states.map(([tile]) => tile.r))) /
        2,
    });
    for (const [tile, kind, label] of states) {
      const target = network.locator(`[data-map-target="${tile.id}"]`);
      const occupant = network.locator(`[data-occupant-tile="${tile.id}"]`);
      await expect(target).toHaveAccessibleDescription(new RegExp(label));
      await expect(target).toBeInViewport({ ratio: 1 });
      await expect(occupant).toHaveAttribute("data-facility-status", kind);
      await expect(occupant).toHaveAttribute("data-visibility-distance", "0");
      const geometry = await network
        .locator("canvas.territory3DCanvas")
        .evaluate(
          (canvas: MapCanvas, id) =>
            canvas.map3DDiagnostics!(true).scene!.find(
              (instance) => instance.id === `structure:${id}`,
            ),
          tile.id,
        );
      expect(
        geometry,
        `${kind} is represented by solid 3D geometry`,
      ).toBeDefined();
      expect(geometry!.active).toBe(kind === "producing");
      if (kind === "construction")
        expect(geometry!.modelKey).toMatch(/:construction$/);
      await expect(occupant.locator(".territoryOccupantArtwork")).toHaveCount(
        0,
      );
      await expect(
        occupant.locator(":scope > .facilityMapStatusArtwork"),
      ).toHaveAttribute("aria-hidden", "true");
    }
    await expectPhysicalMap(network, built);
    if (info.project.name === "desktop-chromium" && theme === "dark")
      await reviewScreenshot(
        network.locator(`[data-occupant-tile="${hydro.tileId}"]`),
        {
          path: info.outputPath("hydro-map-detail-dark.png"),
          animations: "disabled",
          scale: "css",
        },
      );
    await info.attach("facility-state-source", {
      body: JSON.stringify({
        minute: built.date.minute,
        centers,
        facilities: built.facilities.filter((facility) =>
          [hydro.id, oil.id, biomass.id, plant.id].includes(facility.id),
        ),
      }),
      contentType: "application/json",
    });
    await reviewScreenshot(page, {
      path: info.outputPath(`map-facility-states-${theme}.png`),
      animations: "disabled",
      scale: "css",
    });
  });

  test(`map fills the workspace and opens city charts and plant controls in ${theme}`, async ({
    page,
  }, info) => {
    const network = await startMap(page, theme);
    const before = (await readSavedGame(page))!;
    await expect(tileSurface(page)).toHaveCount(0);
    await expect(
      network.locator('[data-map-target][aria-pressed="true"]'),
    ).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: /^(Territories|Fleet|Agreements)$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Map", exact: true }),
    ).toHaveCount(0);
    for (const name of [
      "Fleet",
      "Agreements",
      "Programs",
      "Insights",
      "Events",
      "Scenario",
    ])
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    await page.getByRole("button", { name: "Scenario", exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "Goals", exact: true })
        .getByText("Acquire Valley Electric or Ridge Electric · Dec 2014", {
          exact: true,
        }),
    ).toBeVisible();
    await openMap(page);
    await expectPhysicalMap(network, before);
    const canvas = network.locator("canvas.territory3DCanvas");
    await expect(canvas).toHaveAttribute("data-renderer", "ready");
    const fogScene = await canvas.evaluate(
      (element: MapCanvas) => element.map3DDiagnostics!(true).scene!,
    );
    for (const distance of [1, 2, 3]) {
      const ground = fogScene.find(
        (instance) =>
          instance.id.startsWith("terrain:") && instance.fog === distance,
      );
      expect(ground, `actual 3D fog ring ${distance}`).toBeDefined();
      expect(ground!.fogMix).toBeCloseTo([0, 0.15, 0.35, 0.6][distance]);
      expect(ground!.saturation).toBeCloseTo([1, 0.8, 0.45, 0.15][distance]);
    }
    await expect(
      network.getByRole("heading", { name: "Territories", exact: true }),
    ).toHaveCount(0);
    await expect(
      network.locator(".territoryMapKey,.territoryHexHub,.territoryParcel"),
    ).toHaveCount(0);
    await expect(network).not.toContainText("company power pool");
    await expect(
      network.getByRole("button", { name: "Build", exact: true }),
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
        railWidth:
          element.querySelector(".desktopBuildRail")?.getBoundingClientRect()
            .width ?? 0,
        workspace: { width: workspace.width, height: workspace.height },
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    expect(
      Math.abs(
        dimensions.map.width +
          dimensions.railWidth -
          dimensions.workspace.width,
      ),
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
    await expect(surface).toContainText("Opening customers");
    await expect(surface).toContainText("Current demand");
    await expectCityDemand(surface);
    await reviewScreenshot(page, {
      path: info.outputPath(`city-workspace-${theme}.png`),
      animations: "disabled",
      scale: "css",
    });
    await surface.locator(".tileWorkspaceHeading h3").press("Escape");
    await expect(surface).toHaveCount(0);
    await expect(
      network.locator('[data-map-target][aria-pressed="true"]'),
    ).toHaveCount(0);
    await expect(
      network.getByRole("button", {
        name: "Rapid connection mode",
        exact: true,
      }),
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
    const lake = territoryTileViews(before).find(
      (view) => view.owned && view.tile.terrain === "lake" && !view.facility,
    )!.tile;
    await inspectTile(page, lake);
    await expect(
      network.locator(`[data-map-target="${lake.id}"]`),
    ).toHaveAccessibleDescription(/Enclosed lake basin/);
    await expect(surface).toHaveAccessibleName("Lake");
    await expect(surface).not.toContainText(
      /Hydropower site\. Plant construction|Build a generator or storage on this tile|general construction|300MW max/,
    );
  });

  test(`acquires a neighboring utility directly in ${theme}`, async ({
    page,
  }, info) => {
    const network = await startMap(page, theme);
    const initial = (await readSavedGame(page))!;
    const ridge = getTerritoryTile("ridge-electric:city", initial)!;
    const surface = await inspectTile(page, ridge);
    await expect(surface).toContainText("Estimated demand");
    await expectCityDemand(surface);
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
    const rail = buildRail(page);
    const desktop = await rail.isVisible();
    if (desktop) {
      await selectTerritoryMapTile(page, windTile);
      await expectDialogToFit(surface);
    } else {
      await inspectTile(page, windTile);
    }
    await expectLockedBuild(surface);
    const windChoice = desktop
      ? rail.getByRole("button", {
          name: "Choose sites for Wind",
          exact: true,
        })
      : surface.getByRole("button", {
          name: "Review purchase of Wind",
          exact: true,
        });
    await expect(windChoice).toBeEnabled();
    await expect(
      page.getByRole("tab", { name: "Interties", exact: true }),
    ).toHaveCount(0);
  });

  test(`tile builder keeps project decisions together in ${theme}`, async ({
    page,
  }, info) => {
    const network = await startMap(page, theme);
    const game = (await readSavedGame(page))!;
    loadSimData(game.location);
    const wind = GENERATORS(game, 20e6, [], []).find(
      (item) => item.name === "Wind",
    )!;
    const tile = availableTerritoryTiles(game, wind, "champlain")[0];
    const surface = await inspectTile(page, tile);
    await expectLockedBuild(surface);
    const desktop = await buildRail(page).isVisible();
    let review: Locator;
    if (desktop) {
      const rail = buildRail(page);
      const choice = rail.getByRole("button", {
        name: "Choose sites for Wind",
        exact: true,
      });
      await choice.hover();
      const preview = rail.getByRole("region", {
        name: "Wind technology preview",
        exact: true,
      });
      await expect(preview).toBeVisible();
      const card = preview.locator('[data-build-option="Wind"]');
      await expect(card.locator(".MuiCardHeader-root")).toBeInViewport({
        ratio: 1,
      });
      await expect(
        card.locator(".buildOptionMetric").filter({ hasText: "Build cost" }),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        preview.getByRole("button", { name: "Choose sites", exact: true }),
      ).toHaveCount(0);
      expect(currentTick((await readSavedGame(page))!)!.cash).toBe(
        currentTick(game)!.cash,
      );
      await choice.click();
      await expect(
        network.locator(`[data-map-target="${tile.id}"]`),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        surface.getByText("Build cost", { exact: true }),
      ).toBeVisible();
      await expect(
        surface.getByText("Cash purchase", { exact: true }),
      ).toBeVisible();
      review = surface.getByRole("button", {
        name: "Cancel",
        exact: true,
      });
    } else {
      review = surface.getByRole("button", {
        name: "Review purchase of Wind",
        exact: true,
      });
      await expect(review).toBeEnabled();
      const project = surface.locator('[data-build-option="Wind"]');
      const projectScrollTop = await project.evaluate((element) => {
        let scroll = element.parentElement;
        while (
          scroll &&
          !["auto", "scroll"].includes(getComputedStyle(scroll).overflowY)
        )
          scroll = scroll.parentElement;
        if (!scroll) throw new Error("No project scroll container");
        const capacity = element
          .closest(".tileWorkspaceSurface")!
          .querySelector(".constructionHeader")!;
        const inset = scroll.contains(capacity)
          ? capacity.getBoundingClientRect().height
          : 0;
        scroll.scrollTop +=
          element.getBoundingClientRect().top -
          scroll.getBoundingClientRect().top -
          inset;
        return scroll.scrollTop;
      });
      await expect(surface.locator(".constructionHeader")).toBeInViewport({
        ratio: 1,
      });
      // Scroll the project through the sticky capacity row, as a player does when
      // browsing. Its avatar must pass behind the capacity text rather than over it.
      if ((page.viewportSize()?.width ?? 0) <= 740)
        await project.evaluate((element) => {
          let scroll = element.parentElement;
          while (
            scroll &&
            !["auto", "scroll"].includes(getComputedStyle(scroll).overflowY)
          )
            scroll = scroll.parentElement;
          if (!scroll) throw new Error("No project scroll container");
          const avatar = element
            .querySelector(".MuiCardHeader-avatar")!
            .getBoundingClientRect();
          const capacity = element
            .closest(".tileWorkspaceSurface")!
            .querySelector(".constructionCapacity strong")!
            .getBoundingClientRect();
          scroll.scrollTop +=
            avatar.top + avatar.height / 2 - capacity.top - capacity.height / 2;
        });
      await expect
        .poll(() =>
          surface
            .locator(".constructionCapacity strong")
            .evaluate((element) => {
              const header = element.closest(".constructionHeader")!;
              const bounds = element.getBoundingClientRect();
              return [
                bounds.left + Math.min(4, bounds.width / 4),
                bounds.left + bounds.width / 2,
              ].flatMap((x) => {
                const top = document.elementsFromPoint(
                  x,
                  bounds.top + bounds.height / 2,
                )[0];
                return top && header.contains(top)
                  ? []
                  : [
                      top
                        ?.closest("[data-build-option]")
                        ?.getAttribute("data-build-option") ??
                        top?.tagName ??
                        "outside viewport",
                    ];
              });
            }),
        )
        .toEqual([]);
      await project.evaluate((element, top) => {
        let scroll = element.parentElement;
        while (
          scroll &&
          !["auto", "scroll"].includes(getComputedStyle(scroll).overflowY)
        )
          scroll = scroll.parentElement;
        if (!scroll) throw new Error("No project scroll container");
        scroll.scrollTop = top;
      }, projectScrollTop);
      await expect(project.locator(".MuiCardHeader-root")).toBeInViewport({
        ratio: 1,
      });
      await expect(
        project.locator(".buildOptionMetric").filter({ hasText: "Build cost" }),
      ).toBeInViewport({ ratio: 1 });
    }
    await expect(review).toBeInViewport({ ratio: 1 });
    await expect(
      surface.getByRole("button", { name: "Close tile", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "pause", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    const geometry = await surface.evaluate((element) => {
      const surface = element.getBoundingClientRect();
      const workspace = element
        .closest(".territoryNetwork")!
        .getBoundingClientRect();
      const dock = document
        .querySelector("#navfooter")!
        .getBoundingClientRect();
      return {
        top: surface.top,
        bottom: surface.bottom,
        height: surface.height,
        bodyHeight: element.querySelector(".tileWorkspaceBody")!.clientHeight,
        mapTop: workspace.top,
        dockTop: dock.top,
        overflow: document.documentElement.scrollHeight - innerHeight,
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.mapTop + 16);
    if ((page.viewportSize()?.width ?? 0) <= 740)
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.dockTop);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    await info.attach("tile-builder-geometry", {
      body: JSON.stringify(geometry),
      contentType: "application/json",
    });
    await reviewScreenshot(page, {
      path: info.outputPath(`tile-project-decision-${theme}.png`),
      animations: "disabled",
      scale: "css",
    });
    if (desktop) {
      await expectDialogToFit(surface);
      await review.click();
      await expect(surface).toHaveCount(0);
    } else {
      await review.click();
      const confirmation = page.getByRole("dialog", {
        name: /^Build .* Wind\?/,
      });
      await expectDialogToFit(confirmation);
      await confirmation.press("Escape");
      await expect(confirmation).toHaveCount(0);
    }
    expect(currentTick((await readSavedGame(page))!)!.cash).toBe(
      currentTick(game)!.cash,
    );
    if (!desktop)
      await surface
        .getByRole("button", { name: "Close tile", exact: true })
        .click();
    await expect(
      network.locator('[data-map-target][aria-pressed="true"]'),
    ).toHaveCount(0);
    await expect(
      desktop
        ? buildRail(page)
        : network.getByRole("button", {
            name: "Rapid connection mode",
            exact: true,
          }),
    ).toBeFocused();
  });

  test(`cash buys one tile and its locked generator survives resume in ${theme}`, async ({
    page,
  }, info) => {
    const network = await startMap(page, theme);
    const before = (await readSavedGame(page))!;
    const view = territoryTileViews(before).find(
      (view) => view.tile.id === "green-uplands:site-1",
    );
    expect(view).toBeDefined();
    expect(view).toMatchObject({
      owned: false,
      facility: undefined,
      tile: { terrain: "forest" },
    });
    const tile = view!.tile;
    expect(isAdjacentToOwnedTerritoryTile(before, tile)).toBe(true);
    const neighbor = TERRITORY_TILES.find(
      (other) => other.territoryId === tile.territoryId && other.id !== tile.id,
    )!;
    const quote = tilePurchaseQuote(before, tile.id)!;
    expect(quote).toBeDefined();
    const surface = await inspectTile(page, tile);
    const wind = getTerrainModifiers(before, "Wind", tile.id);
    const modifiers = surface.getByRole("region", {
      name: "Terrain modifiers",
    });
    const percentage = (factor: number) =>
      `${factor >= 1 ? "+" : "−"}${Math.round(Math.abs(factor - 1) * 100)}%`;
    for (const [label, factor] of [
      ["wind speed", wind.onshoreWindSpeed],
      ["build cost", wind.buildCost],
    ] as const) {
      expect(factor).not.toBe(1);
      await expect(
        modifiers.getByRole("listitem").filter({ hasText: label }),
      ).toHaveText(`${percentage(factor)} ${label}`);
    }
    await reviewScreenshot(surface, {
      path: info.outputPath(`unowned-terrain-${theme}.png`),
      animations: "disabled",
      scale: "css",
    });
    await expect(surface).not.toContainText("Cash after connection");
    await expect(
      surface.getByRole("button", {
        name: `Connect · ${formatPurchasePrice(quote.price)}`,
        exact: true,
      }),
    ).toBeEnabled();
    await surface.getByRole("button", { name: /^Connect ·/ }).click();
    await expectLockedBuild(surface);
    await expect(surface.locator(".tileWorkspaceHeading h3")).toBeFocused();
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
    const review = await reviewTileBuild(page, "Wind");
    await expectDialogToFit(review);
    await confirmTileBuild(page, review, tile);
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
    await expect(surface.locator(".tileWorkspaceHeading h3")).toBeFocused();
    await expect(
      surface.getByRole("button", { name: /^Cancel construction of / }),
    ).toBeEnabled();
    await expect(
      surface.getByRole("tab", { name: "Generators", exact: true }),
    ).toHaveCount(0);
    await expectPhysicalMap(network, built);
    await inspectTile(page, neighbor);
    await expect(
      surface.getByRole("button", { name: /^Connect ·/ }),
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
    const view = territoryTileViews(before).find(
      (view) => view.tile.id === "champlain:site-13",
    );
    expect(view).toBeDefined();
    expect(view).toMatchObject({
      owned: true,
      facility: undefined,
      tile: { siteKind: "open-land", terrain: "plains" },
    });
    const tile = view!.tile;
    await openMap(page);
    const surface = await inspectTile(page, tile);
    await expectLockedBuild(surface);
    if (await buildRail(page).isVisible()) {
      await setMapProjectCapacity(buildRail(page), true, "4");
    } else {
      await surface.getByRole("tab", { name: "Storage", exact: true }).click();
      await expectLockedBuild(surface);
      await surface.getByRole("slider", { name: /^Capacity/ }).press("Home");
    }
    const capacityWh = 5e6;
    const review = await reviewTileBuild(page, "Battery");
    await expectDialogToFit(review);
    await confirmTileBuild(page, review, tile);
    const built = (await readSavedGame(page))!;
    const storage = built.facilities.find(
      (facility) => facility.tileId === tile.id,
    )!;
    expect(storage).toEqual(
      expect.objectContaining({
        name: "Battery",
        territoryId: tile.territoryId,
        tileId: tile.id,
        peakWh: capacityWh,
      }),
    );
    loadSimData(before.location);
    const quote = getBuildFacilityQuote(
      before,
      { name: "Battery", peakWh: capacityWh },
      tile.territoryId,
      tile.id,
    )!;
    expect(quote).toBeDefined();
    const available = availableTerritoryTiles(before, quote, tile.territoryId);
    expect(available.map((option) => option.id)).toContain(tile.id);
    expect(available[0]?.id).not.toBe(tile.id);
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
    await openMap(page);
    const resumed = await inspectTile(page, tile);
    await expect(
      resumed.getByRole("heading", { name: "Battery", exact: true }),
    ).toBeVisible();
    await expect(
      resumed.getByRole("region", { name: "Construction", exact: true }),
    ).toContainText(formatWattHours(capacityWh));
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
        view.visibilityDistance === 1 &&
        tilePurchaseQuote(before, view.tile.id)?.benefit === "general",
    )!.tile;
    await panToTile(page, frontier);
    const toggle = network.getByRole("button", {
      name: "Rapid connection mode",
      exact: true,
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const target = network.locator(`[data-map-target="${frontier.id}"]`);
    await expect(target).toHaveAccessibleName(/Connect .*\$.*General site/);
    const viewport = network.locator(".territoryMapViewport");
    const beforeDrag = await readTerritoryMapCamera(viewport);
    const columns = views.map(({ tile }) => hexCenter(tile).x);
    const boardCenterX = (Math.min(...columns) + Math.max(...columns)) / 2;
    const dragX = beforeDrag.x > boardCenterX ? 60 : -60;
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
          touchPoints: [{ x: x + (step * dragX) / 6, y }],
        });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await session.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dragX, y, { steps: 6 });
      await page.mouse.up();
    }
    await expect
      .poll(async () => {
        const camera = await readTerritoryMapCamera(viewport);
        return (camera.x - beforeDrag.x) * camera.scale * Math.sign(-dragX);
      })
      .toBeGreaterThan(24);
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
    const camera = await readTerritoryMapCamera(viewport);
    const quote = tilePurchaseQuote(before, frontier.id)!;
    await reviewScreenshot(page, {
      path: info.outputPath(`rapid-buy-${theme}.png`),
      animations: "disabled",
      scale: "css",
    });
    await target.click();
    await expect(target).toHaveAttribute("data-owned", "true");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(tileSurface(page)).toHaveCount(0);
    expect(await readTerritoryMapCamera(viewport)).toEqual(camera);
    const bought = (await readSavedGame(page))!;
    expect(currentTick(bought)!.cash).toBeCloseTo(
      currentTick(before)!.cash - quote.price,
      1,
    );
    expect(bought.territoryNetwork!.tilePurchases).toHaveLength(1);
    const connectedViews = territoryTileViews(bought);
    expect(connectedViews.map(({ tile }) => tile.id)).toEqual(
      views.map(({ tile }) => tile.id),
    );
    expect(
      connectedViews.find(({ tile }) => tile.id === frontier.id)
        ?.visibilityDistance,
    ).toBe(0);
    const canvas = network.locator("canvas.territory3DCanvas");
    if ((await canvas.getAttribute("data-renderer")) === "ready") {
      await expect
        .poll(() =>
          canvas.evaluate(
            (element: MapCanvas, id) =>
              element.map3DDiagnostics!(true).scene?.find(
                (instance) => instance.id === `terrain:${id}`,
              )?.fog,
            frontier.id,
          ),
        )
        .toBe(0);
    } else {
      await expect(
        network.locator(`.territoryHex[data-tile="${frontier.id}"]`),
      ).toHaveAttribute("data-visibility-distance", "0");
    }
    await expect(
      network.getByRole("status", { name: "Connection result" }),
    ).toContainText("Site connected");
    await expect(
      network.getByRole("status", { name: "Connection result" }),
    ).toContainText(
      `${formatMoneyConcise(currentTick(bought)!.cash)} cash remaining`,
    );
    await expect(
      page.locator("#appbar:visible .gameBalance > .gameStatusValue"),
    ).toHaveText(formatMoneyStable(currentTick(bought)!.cash));
    const next = territoryTileViews(bought).find(
      (view) => tilePurchaseQuote(bought, view.tile.id)?.benefit === "general",
    )!.tile;
    await panToTile(page, next);
    const nextTarget = network.locator(`[data-map-target="${next.id}"]`);
    await nextTarget.press("Enter");
    await expect(nextTarget).toHaveAttribute("data-owned", "true");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(
      (await readSavedGame(page))!.territoryNetwork!.tilePurchases,
    ).toHaveLength(2);
    await nextTarget.press("Escape");
    await expect(
      network.getByRole("button", {
        name: "Rapid connection mode",
        exact: true,
      }),
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
      .getByRole("button", { name: "Rapid connection mode", exact: true })
      .click();
    const target = network.locator(`[data-map-target="${tile.id}"]`);
    await expect(target).toHaveAccessibleName(
      /Inspect .*not enough available cash/,
    );
    await expect(target).not.toContainText(/General site|Not enough cash/);
    await target.click();
    const surface = tileSurface(page);
    await expect(
      surface.getByRole("button", { name: /^Connect ·/ }),
    ).toBeDisabled();
    await expect(surface.getByRole("status")).toContainText("more cash needed");
    expect(currentTick((await readSavedGame(page))!)!.cash).toBe(1);
    await surface.locator(".tileWorkspaceHeading h3").press("Escape");
    await expect(surface).toHaveCount(0);
    await expect(target).toHaveAttribute("aria-pressed", "false");
    const buy = network.getByRole("button", {
      name: "Rapid connection mode",
      exact: true,
    });
    await expect(buy).toBeFocused();
    await expect(buy).toHaveAttribute("aria-pressed", "false");
  });

  test(`acquires Vergennes from its plant border in ${theme}`, async ({
    page,
  }) => {
    await startMap(page, theme);
    const city = getTerritoryTile("parcel-1:city")!;
    const plant = getTerritoryTile("parcel-0:site-1")!;
    await editSavedGame(page, ({ game }) => {
      for (const tileId of [
        "green-uplands:site-2",
        "green-uplands:site-5",
      ] as const) {
        const quote = tilePurchaseQuote(game, tileId)!;
        expect(purchaseTile(game, { tileId, quoteKey: quote.quoteKey })).toBe(
          true,
        );
      }
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const map = await openMap(page);
    const before = (await readSavedGame(page))!;
    expect(isAdjacentToOwnedTerritoryTile(before, city)).toBe(false);
    const quote = tilePurchaseQuote(before, plant.id)!;
    expect(tilePurchaseQuote(before, city.id)?.price).toBe(quote.price);
    await panToTile(page, plant);
    await map.locator(`[data-map-target="${plant.id}"]`).click();
    const surface = tileSurface(page);
    await expect(surface).toContainText(quote.utilityName!);
    await surface.getByRole("button", { name: /^Acquire utility ·/ }).click();
    const saved = (await readSavedGame(page))!;
    expect(ownsTerritoryTile(saved, plant.id)).toBe(true);
    expect(ownsTerritoryTile(saved, city.id)).toBe(true);
    expect(currentTick(saved)!.customers - currentTick(before)!.customers).toBe(
      quote.customers,
    );
    expect(currentTick(saved)!.cash).toBeCloseTo(
      currentTick(before)!.cash - quote.price,
      1,
    );
    expect(saved.facilities).toHaveLength(before.facilities.length);
    await surface
      .getByRole("button", { name: "Close tile", exact: true })
      .click();
    await selectTerritoryMapTile(page, city);
    const cityPanel = tileSurface(page);
    await expect(cityPanel).toHaveAccessibleName("Vergennes");
    await expect(cityPanel).toContainText("Customers transferred");
    await expectCityDemand(cityPanel);
  });

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
      if (!tilePurchaseQuote((await readSavedGame(page))!, tile.id)) {
        await editSavedGame(page, ({ game }) =>
          connectFrontierToSite(game, tile),
        );
        await page.goto("/");
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await openMap(page);
      }
      const surface = await inspectTile(page, tile);
      await surface.getByRole("button", { name: /^Connect ·/ }).click();
      await expectLockedBuild(surface);
      const plant = await reviewTileBuild(page, resource.name);
      await expectDialogToFit(plant);
      await confirmTileBuild(page, plant, tile, true);
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
  await page.addInitScript(() => {
    Math.random = () => 0.25;
  });
  await startMap(page, "light");
  // The reducer can queue notifications during settlement, even in a fixture.
  await import("../src/Store");
  // Build the months of history with the real reducer, then let the browser settle
  // and persist the rollover itself. The save test does not depend on host frame rate.
  await editSavedGame(page, ({ game }) => {
    loadSimData(game.location);
    const boundary = 12 * MINUTES_PER_MONTH - TICK_MINUTES * 15;
    for (
      let minute = game.date.minute;
      minute < boundary;
      minute += TICK_MINUTES
    )
      tickState(game);
    expect(game.date.minute).toBe(boundary);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await expect
    .poll(async () => (await readSavedGame(page))?.monthlyHistory.length ?? 0)
    .toBeGreaterThanOrEqual(12);
  await page.getByRole("button", { name: "pause", exact: true }).click();
  const before = (await readSavedGame(page))!;
  expect(before.date.year).toBe(before.startingYear + 1);
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

test("map tile hover and right-click expose the tile's own actions", async ({
  page,
}, info) => {
  const network = await startMap(page, "light");
  const tile = TERRITORY_TILES.find(({ id }) => id === "green-uplands:site-1")!;
  const game = (await readSavedGame(page))!;
  const quote = tilePurchaseQuote(game, tile.id)!;
  await panToTile(page, tile);
  const target = network.locator(`[data-map-target="${tile.id}"]`);

  await target.hover();
  const tooltip = network.getByRole("tooltip");
  await expect(tooltip).toHaveText("Forest · Open site · Unconnected");
  await expect(target).not.toHaveAttribute("title", /.+/);

  await target.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Tile actions" });
  const connect = menu.getByRole("menuitem", {
    name: `Connect (${formatPurchasePrice(quote.price)})`,
    exact: true,
  });
  await expect(connect).toBeEnabled();
  await expect(tooltip).toHaveCount(0);
  await expect(connect).toBeFocused();
  await expect(menu).toBeInViewport({ ratio: 1 });
  await reviewScreenshot(page, {
    path: info.outputPath("tile-context-menu.png"),
    animations: "disabled",
    scale: "css",
  });
  await connect.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(target).toBeFocused();

  await target.press("Shift+F10");
  await menu.getByRole("menuitem", { name: "Inspect", exact: true }).click();
  const inspector = network.getByRole("dialog", {
    name: "Forest",
    exact: true,
  });
  await expect(
    inspector.getByRole("heading", { name: "Forest" }),
  ).toBeFocused();
  await inspector.getByRole("button", { name: "Close tile" }).click();

  await target.press("Shift+F10");
  await connect.click();
  await expect(target).toHaveAttribute("data-owned", "true");
  await expect
    .poll(async () => ownsTerritoryTile((await readSavedGame(page))!, tile.id))
    .toBe(true);
});
