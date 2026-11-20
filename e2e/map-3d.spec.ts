import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";
import type { MapCanvas } from "../src/components/base/territory-3d/Types";
import type { TerritoryTileId } from "../src/Types";
import {
  readTerritoryMapCamera,
  openMapProjectCatalogue,
  returnToTerritoryMap,
  setMapProjectCapacity,
} from "./layout";
import { reviewScreenshot } from "./review-screenshot";
import { getBuildFacilityQuote } from "../src/data/Facilities";
import gameReducer, { buildFacility } from "../src/reducers/Game";
import { getTerritoryTile } from "../src/helpers/TerritoryTiles";
import { getTerrainModel } from "../src/components/base/territory-3d/TerrainModels";
import { editSavedGame, readSavedGame } from "./save-fixture";
import { TICK_MINUTES } from "../src/Constants";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../src/helpers/DateTime";
import {
  COLD_DEFINITION_ID,
  HAIL_DEFINITION_ID,
  WILDFIRE_DAMAGE_ID,
} from "../src/helpers/Hazards";
import {
  FIRE_BURN_MINUTES,
  FIRE_REPAIR_MINUTES,
  FIRE_SPREAD_MINUTES,
} from "../src/helpers/TerritoryWildfire";
import { loadSimData } from "../src/testing/SimData";
import {
  projectCatalogue,
  projectSiteCapitalCost,
  projectSiteQuote,
  selectProject,
} from "../src/helpers/ProjectBuild";
import { formatMoneyConcise } from "../src/helpers/Format";
import {
  projectPoint,
  tilePosition3D,
} from "../src/components/base/territory-3d/Projection";

for (const theme of ["light", "dark"] as const) {
  test(`renders real 3D, preserves map controls and recovers a lost context · ${theme}`, async ({
    page,
  }, info) => {
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
    const canvas = map.locator("canvas.territory3DCanvas");
    await expect(canvas).toHaveAttribute("data-renderer", "ready");
    const before = await canvas.evaluate((element: MapCanvas) =>
      element.map3DDiagnostics!(),
    );
    expect(before.drawCalls).toBeGreaterThan(5);
    expect(before.triangles).toBeGreaterThan(100);
    expect(before.instanceCount).toBeGreaterThan(10);
    await expect(map.locator(".territoryTerrainArtwork")).toHaveCount(0);
    await expect(map.locator(".territoryOccupantArtwork")).toHaveCount(0);
    await expect(
      map.getByRole("button", { name: "Build", exact: true }),
    ).toHaveCount(0);
    const capital = map.locator('[data-map-target="champlain:city"]');
    await expect(
      capital.getByText("Burlington", { exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".gridStatusButton:visible")).toContainText(
      /NOW.*[kMGT]?W/,
    );
    await reviewScreenshot(map, {
      path: info.outputPath(`map-3d-${theme}.png`),
    });
    if (!page.viewportSize() || page.viewportSize()!.width >= 1024) {
      const viewport = map.locator(".territoryMapViewport");
      const bounds = (await viewport.boundingBox())!;
      const cameraX = (await readTerritoryMapCamera(viewport)).x;
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      await page.mouse.move(x, y);
      const hovered = viewport.locator(
        '[data-model-hovered="true"] .territoryTileHitArea',
      );
      await expect(hovered).toHaveCSS("background-image", /radial-gradient/);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(x + 40, y + 20, { steps: 4 });
      await page.mouse.up({ button: "middle" });
      await expect
        .poll(async () => (await readTerritoryMapCamera(viewport)).x)
        .not.toBe(cameraX);
      await expect(page.locator(".tileWorkspaceSurface")).toHaveCount(0);
    }
    const contextLoss = await canvas.evaluateHandle((element: MapCanvas) => {
      const gl = element.getContext("webgl2")!;
      const loss = gl.getExtension("WEBGL_lose_context");
      if (!loss)
        throw new Error("Context-loss extension unavailable in test browser");
      loss.loseContext();
      return loss;
    });
    await expect(canvas).toHaveAttribute("data-renderer", "lost");
    await expect(map.locator(".territoryTerrainArtwork").first()).toBeVisible();
    await map
      .getByRole("button", { name: "Rapid connection mode", exact: true })
      .click();
    await expect(map.locator(".territoryMap")).toHaveAttribute(
      "data-buy-mode",
      "true",
    );
    await contextLoss.evaluate((loss) => loss.restoreContext());
    await expect(canvas).toHaveAttribute("data-renderer", "ready");
    await expect(map.locator(".territoryTerrainArtwork")).toHaveCount(0);
    const after = await canvas.evaluate((element: MapCanvas) =>
      element.map3DDiagnostics!(),
    );
    expect(after.frames).toBeGreaterThan(before.frames);
    expect(after.light).toEqual(before.light);
    await expect(map.locator(".territoryMap")).toHaveAttribute(
      "data-buy-mode",
      "true",
    );
  });
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  const animate = reducedMotion === "no-preference";
  test(
    animate
      ? "tapping a tile shifts the phone camera"
      : "reduced motion recenters the phone camera immediately",
    async ({ page }, info) => {
      const phone = page.viewportSize()!.width <= 740;
      test.skip(!phone && !animate, "Desktop does not recenter");
      await page.emulateMedia({ reducedMotion });
      await page.clock.install();
      await page.goto("/?scenario=116");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const pause = page.getByRole("button", { name: "pause", exact: true });
      if ((await pause.getAttribute("aria-pressed")) !== "true")
        await pause.click();
      const map = await returnToTerritoryMap(page);
      await expect(map.locator("canvas.territory3DCanvas")).toHaveAttribute(
        "data-renderer",
        "ready",
      );
      const viewport = map.getByRole("region", { name: "Territory map" });
      const capital = map.locator('[data-map-target="champlain:city"]');
      const label = capital.getByText("Burlington", { exact: true });
      await expect(label).toBeInViewport({ ratio: 1 });
      if (phone && animate)
        await reviewScreenshot(map, {
          path: info.outputPath("before-tap.png"),
        });

      // Shared-runner frame gaps can skip the whole shift. Drive the real camera
      // through intermediate frames before checking its destination.
      // Freeze wall time first so a delayed pause RPC cannot target the past.
      const pauseTime = await page.evaluate(() => Date.now());
      await page.clock.setFixedTime(pauseTime);
      await page.clock.pauseAt(pauseTime);
      await page.clock.setSystemTime(pauseTime);
      const positions = await viewport.evaluateHandle((element) => {
        const stage = element.querySelector<HTMLElement>(".territoryMapStage")!;
        const x: number[] = [];
        const sample = () => x.push(new DOMMatrix(stage.style.transform).e);
        sample();
        const observer = new MutationObserver(sample);
        observer.observe(stage, { attributeFilter: ["style"] });
        return {
          finish() {
            observer.disconnect();
            return x;
          },
        };
      });
      if (info.project.use.hasTouch) await label.tap();
      else await label.click();
      await page.clock.runFor(64);
      await page.clock.runFor(200);
      await expect(
        page.getByRole("button", { name: "Close tile" }),
      ).toBeVisible();

      if (phone) {
        await expect
          .poll(() =>
            capital.evaluate((element) => {
              const tile = element.getBoundingClientRect();
              const map = element
                .closest(".territoryMapViewport")!
                .getBoundingClientRect();
              return tile.x + tile.width / 2 - map.x - map.width / 2;
            }),
          )
          .toBeCloseTo(0, 0);
        const [start, ...movement] = await positions.evaluate((p) =>
          p.finish(),
        );
        const end = movement.at(-1)!;
        expect(Math.abs(end - start)).toBeGreaterThan(20);
        const intermediate = movement.filter(
          (x) => x > Math.min(start, end) + 1 && x < Math.max(start, end) - 1,
        );
        if (animate) {
          expect(intermediate.length).toBeGreaterThan(0);
          await reviewScreenshot(map, {
            path: info.outputPath("after-tap.png"),
          });
        } else {
          expect(intermediate).toHaveLength(0);
        }
      } else {
        expect(new Set(await positions.evaluate((p) => p.finish())).size).toBe(
          1,
        );
      }
    },
  );
}

test("clicking real mountain relief above its ground selects the mountain tile", async ({
  page,
}, info) => {
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
  const mountainId = await map
    .locator('[data-map-target][data-terrain="mountain"]:not([data-owner])')
    .evaluateAll((elements) => {
      const viewport = elements[0]
        .closest(".territoryMapViewport")!
        .getBoundingClientRect();
      return elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            id: element.getAttribute("data-map-target")!,
            distance: Math.hypot(
              box.x + box.width / 2 - viewport.x - viewport.width / 2,
              box.y + box.height / 2 - viewport.y - viewport.height / 2,
            ),
          };
        })
        .sort((a, b) => a.distance - b.distance)[0].id;
    });
  const mountain = map.locator(`[data-map-target="${mountainId}"]`);
  const tile = getTerritoryTile(
    (await mountain.getAttribute("data-map-target"))!,
  )!;
  // Force keyboard focus-visible before focusing a tile that is outside the tab order.
  await page.keyboard.press("Tab");
  await mountain.focus();
  await expect(mountain).toBeFocused();
  await expect(mountain).toHaveAttribute("aria-pressed", "true");
  if (!info.project.use.hasTouch)
    expect(
      await mountain.evaluate((button) => button.matches(":focus-visible")),
    ).toBe(true);
  await expect(mountain).toHaveCSS("outline-style", "none");
  await expect(mountain.locator(".territoryTileHitArea")).toHaveCSS(
    "outline-style",
    "none",
  );
  const selection = map.locator(".territoryHexSelection");
  await expect(selection).toHaveAttribute("d", /^(?:M[^M]+){6}$/);
  await expect(selection).toHaveCSS("stroke-dasharray", "4px, 4px");
  await mountain.press("Escape");
  await expect(mountain).toHaveAttribute("aria-pressed", "false");
  await expect(
    map.getByRole("button", { name: "Rapid connection mode", exact: true }),
  ).toBeFocused();
  const viewport = map.locator(".territoryMapViewport");
  const {
    x: cameraX,
    y: cameraY,
    scale,
  } = await readTerritoryMapCamera(viewport);
  const { width, height } = await viewport.evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
  }));
  const frame = { width, height, cameraX, cameraY, scale };
  // Take a point inside the actual highest relief triangle, close to its peak.
  const mesh = getTerrainModel("mountain").parts[1].mesh.positions;
  let peak = [0, -Infinity, 0];
  for (let i = 0; i < mesh.length; i += 9) {
    const vertices = [0, 3, 6].map((offset) =>
      Array.from(mesh.slice(i + offset, i + offset + 3)),
    );
    vertices.sort((a, b) => b[1] - a[1]);
    if (vertices[0][1] <= peak[1]) continue;
    peak = vertices[0].map(
      (value, axis) =>
        value * 0.9 + (vertices[1][axis] + vertices[2][axis]) * 0.05,
    );
  }
  const origin = tilePosition3D(tile);
  const point = projectPoint(
    [origin[0] + peak[0], peak[1], origin[2] + peak[2]],
    frame,
  );
  const bounds = (await viewport.boundingBox())!;
  const click = { x: bounds.x + point.x, y: bounds.y + point.y };
  const ground = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-map-target]")
        ?.dataset.mapTarget,
    click,
  );
  // With a finite board, a foreground peak can also project above the map edge.
  expect(point.x).toBeGreaterThan(0);
  expect(point.x).toBeLessThan(width);
  expect(point.y).toBeGreaterThan(0);
  expect(point.y).toBeLessThan(height);
  expect(ground).not.toBe(tile.id);
  await page.mouse.click(click.x, click.y);
  await expect(mountain).toHaveAttribute("aria-pressed", "true");
});

for (const theme of ["light", "dark"] as const) {
  test(`connected project site markers fit on one line · ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(
      (mode) => localStorage.setItem("theme", mode),
      theme,
    );
    await page.goto("/?scenario=116");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pause = page.getByRole("button", { name: "pause", exact: true });
    await expect(pause).toBeVisible();
    if ((await pause.getAttribute("aria-pressed")) !== "true")
      await pause.click();
    const map = await returnToTerritoryMap(page);
    const catalogue = await openMapProjectCatalogue(page);
    await setMapProjectCapacity(catalogue, false, "10");
    const surface = page.locator(".tileWorkspaceSurface");
    await catalogue
      .getByRole("button", { name: "Choose sites for Wind", exact: true })
      .click();
    await expect(
      surface.getByText("Connected · total project cost", { exact: true }),
    ).toBeVisible();
    const markers = map.locator(
      '[data-project-site="owned"] .territoryTilePrice',
    );
    await expect(markers.first()).toBeVisible();
    const sizes = await markers.evaluateAll((elements) =>
      elements.map((element) => {
        const label = element.querySelector("b")!;
        const range = document.createRange();
        range.selectNodeContents(label);
        const box = element.getBoundingClientRect();
        const tile = element
          .closest("[data-map-target]")!
          .getBoundingClientRect();
        return {
          lines: range.getClientRects().length,
          textWidth: range.getBoundingClientRect().width,
          width: box.width,
          height: box.height,
          tileWidth: tile.width,
          tileHeight: tile.height,
        };
      }),
    );
    for (const size of sizes) {
      expect(size.lines).toBe(1);
      expect(size.textWidth).toBeLessThanOrEqual(size.width);
      expect(size.width).toBeLessThanOrEqual(size.tileWidth);
      expect(size.height).toBeLessThanOrEqual(size.tileHeight / 2);
    }
    const game = (await readSavedGame(page))!;
    loadSimData(game.location);
    const project = selectProject(
      projectCatalogue(game, 20e6, false).find(({ name }) => name === "Wind")!,
    );
    const id = (await map
      .locator('[data-project-site="owned"]')
      .first()
      .getAttribute("data-map-target")) as TerritoryTileId;
    // Focusing can recenter the camera and change which sites are mounted first.
    const owned = map.locator(`[data-map-target="${id}"]`);
    const ownedMarker = owned.locator(".territoryTilePrice");
    const quote = projectSiteQuote(game, project, id);
    expect(quote.facility).toBeDefined();
    if (!quote.facility) throw new Error("Owned project site has no quote");
    const total = formatMoneyConcise(projectSiteCapitalCost(quote));
    const title = `Total project cost ${total} · Already connected`;
    await expect(ownedMarker).toHaveAttribute("title", title);
    await expect(ownedMarker).toHaveText(total);
    await expect(owned).toHaveAccessibleName(
      /Total project cost .*Already connected/,
    );
    await owned.focus();
    await owned.press("Enter");
    await expect(surface.getByText("Already connected · $0")).toBeVisible();
    await ownedMarker.hover();
    await expect(ownedMarker).toHaveAttribute("title", title);
    await page.mouse.move(0, 0);
    await reviewScreenshot(map, {
      path: info.outputPath(`project-markers-${theme}.png`),
    });
  });
}

test("unavailable WebGL leaves a fully operable simplified map", async ({
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
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/?scenario=116");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const pause = page.getByRole("button", { name: "pause", exact: true });
  await expect(pause).toBeVisible();
  if ((await pause.getAttribute("aria-pressed")) !== "true")
    await pause.click();
  const map = await returnToTerritoryMap(page);
  await expect(map.locator("canvas.territory3DCanvas")).toHaveAttribute(
    "data-renderer",
    "unavailable",
  );
  await expect(map.locator(".territoryTerrainArtwork").first()).toBeVisible();
  const catalogue = await openMapProjectCatalogue(page);
  await catalogue
    .getByRole("button", { name: "Choose sites for Wind", exact: true })
    .click();
  await expect(
    map.locator('[data-project-site="owned"]').first(),
  ).toBeVisible();
});

test("map windows move, resize, stack and remember their bounds", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("audioEnabled", "false");
  });
  const startMap = async () => {
    await page.goto("/?scenario=116");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const map = await returnToTerritoryMap(page);
    await expect(map.locator("canvas.territory3DCanvas")).toHaveAttribute(
      "data-renderer",
      "ready",
    );
    const pause = page.getByRole("button", { name: "pause", exact: true });
    if ((await pause.getAttribute("aria-pressed")) !== "true")
      await pause.click();
    return map;
  };
  const map = await startMap();
  const fleet = page.getByRole("region", { name: "Fleet", exact: true });
  const agreements = page.getByRole("region", {
    name: "Agreements",
    exact: true,
  });
  const fleetAction = page.getByRole("button", { name: "Fleet", exact: true });
  const agreementsAction = page.getByRole("button", {
    name: "Agreements",
    exact: true,
  });
  await fleetAction.click();
  await expect(fleet).toBeVisible();

  const viewport = page.viewportSize()!;
  if (viewport.width < 1024) {
    await expect(
      fleet.getByRole("button", { name: "Resize Fleet" }),
    ).toHaveCount(0);
    await agreementsAction.click();
    await expect(agreements).toBeVisible();
    await expect(fleet).toHaveCount(0);
    await expect(map).toBeVisible();
    return;
  }

  const drag = async (target: Locator, dx: number, dy: number) => {
    const { x, y, width, height } = (await target.boundingBox())!;
    const startX = x + width / 2;
    const startY = y + height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + dx, startY + dy, { steps: 5 });
    await page.mouse.up();
  };
  const title = fleet.getByRole("heading", { name: "Fleet", exact: true });
  const resize = fleet.getByRole("button", { name: "Resize Fleet" });
  const initial = (await fleet.boundingBox())!;
  const camera = await readTerritoryMapCamera(
    map.locator(".territoryMapViewport"),
  );
  await drag(title, -144, 48);
  await expect
    .poll(() => fleet.boundingBox())
    .toEqual({ ...initial, x: initial.x - 144, y: initial.y + 48 });
  await drag(resize, 64, 48);
  const saved = {
    x: initial.x - 144,
    y: initial.y + 48,
    width: initial.width + 64,
    height: initial.height + 48,
  };
  await expect.poll(() => fleet.boundingBox()).toEqual(saved);
  expect(
    await readTerritoryMapCamera(map.locator(".territoryMapViewport")),
  ).toEqual(camera);

  await agreementsAction.click();
  await expect(page.locator("#facilitiesPane")).toHaveCount(1);
  await expect(page.locator("#agreementsPane")).toHaveCount(1);
  const second = (await agreements.boundingBox())!;
  const overlap = { x: second.x + 60, y: saved.y + 84 };
  const atOverlap = () =>
    page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest(".gameToolPanel")
          ?.getAttribute("aria-label"),
      overlap,
    );
  await expect.poll(atOverlap).toBe("Agreements");
  await reviewScreenshot(page.locator(".gameStage"), {
    path: info.outputPath("stacked-map-windows.png"),
    animations: "disabled",
    scale: "css",
  });
  await page.mouse.click(saved.x + 16, saved.y + saved.height - 20);
  await expect.poll(atOverlap).toBe("Fleet");
  await expect(agreementsAction).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");
  await expect(fleet).toHaveCount(0);
  await expect(agreements).toBeVisible();
  await expect(fleetAction).toBeFocused();
  await fleetAction.click();
  await expect.poll(() => fleet.boundingBox()).toEqual(saved);
  await agreementsAction.click();
  await expect(agreements).toHaveAttribute("data-map-window-front", "true");
  await agreementsAction.click();
  await expect(agreements).toHaveCount(0);
  await expect(fleet).toBeVisible();

  await page.setViewportSize({ width: 1060, height: 580 });
  await expect(
    fleet.getByRole("button", { name: "Close Fleet" }),
  ).toBeInViewport();
  await expect(resize).toBeInViewport();
  await resize.press("ArrowRight");
  await page.setViewportSize(viewport);
  await expect.poll(() => fleet.boundingBox()).toEqual(saved);

  await startMap();
  await fleetAction.click();
  await expect.poll(() => fleet.boundingBox()).toEqual(saved);
  await title.press("ArrowLeft");
  await resize.press("ArrowLeft");
  await expect
    .poll(() => fleet.boundingBox())
    .toEqual({
      ...saved,
      x: saved.x - 16,
      width: saved.width - 16,
    });

  await page.setViewportSize({ width: 1060, height: 580 });
  await expect(resize).toBeInViewport();
  // Wait for the workspace observer to fit the window to the smaller tray.
  await expect
    .poll(() =>
      fleet.evaluate((element: HTMLElement) => {
        const tray = element.parentElement!;
        return {
          rightGap: tray.clientWidth - element.offsetLeft - element.offsetWidth,
          bottomGap:
            tray.clientHeight - element.offsetTop - element.offsetHeight,
        };
      }),
    )
    .toEqual({ rightGap: 0, bottomGap: 0 });
  const horizontalBounds = () =>
    fleet.evaluate((element: HTMLElement) => ({
      left: element.offsetLeft,
      width: element.offsetWidth,
    }));
  const clamped = await horizontalBounds();
  await drag(resize, -32, 0);
  await expect.poll(horizontalBounds).toEqual({
    left: clamped.left,
    width: clamped.width - 32,
  });
});

test("shows an advancing wildfire and scar with WebGL or the SVG fallback", async ({
  page,
}, info) => {
  const theme = info.project.name === "desktop-chromium" ? "light" : "dark";
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
  await expect
    .poll(async () => (await readSavedGame(page))?.scenarioId)
    .toBe(116);
  const burned = "valley-electric:site-4";
  const front = "champlain:site-9";
  const burning = "champlain:site-8";
  await editSavedGame(page, ({ game }) => {
    const wind = game.facilities.find(
      (facility) => facility.tileId === burning,
    )!;
    game.date = getDateFromMinute(
      FIRE_BURN_MINUTES + TICK_MINUTES,
      game.startingYear,
    );
    game.speed = "PAUSED";
    game.territoryWeather = {
      dryness: 0.81,
      fires: [
        {
          startsMinute: 0,
          tiles: [
            { tileId: burned, ignitesMinute: 0 },
            { tileId: front, ignitesMinute: FIRE_SPREAD_MINUTES },
            { tileId: burning, ignitesMinute: 2 * FIRE_SPREAD_MINUTES },
          ],
        },
      ],
    };
    game.worldEvents.active.push({
      key: "review-wildfire",
      definitionId: WILDFIRE_DAMAGE_ID,
      startsMinute: 2 * FIRE_SPREAD_MINUTES,
      endsMinute: 2 * FIRE_SPREAD_MINUTES + FIRE_REPAIR_MINUTES,
      attributes: { hazard: "WILDFIRE", facilityId: wind.id },
      effects: { facilityOutputMultipliersById: { [wind.id]: 0.55 } },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const map = await returnToTerritoryMap(page);
  const canvas = map.locator("canvas.territory3DCanvas");
  await expect(canvas).toHaveAttribute("data-renderer", "ready");
  const diagnostics = () =>
    canvas.evaluate((element: MapCanvas) => element.map3DDiagnostics!());
  const initial = await diagnostics();
  expect(initial.motionAllowed).toBe(false);
  expect(initial.wildfire).toMatchObject({ drawCalls: 1, time: 0 });
  expect(initial.wildfire.particles).toBeGreaterThan(2 * 60);
  expect(initial.wildfire.particles).toBeLessThanOrEqual(216);
  const active = map.locator(`[data-map-target="${burning}"]`);
  const scar = map.locator(`[data-map-target="${burned}"]`);
  await active.focus();
  await expect(active).toHaveAccessibleDescription(
    /Wildfire burning.*Wildfire damage.*55% available/,
  );
  await expect(active).toBeInViewport({ ratio: 0.75 });
  await expect(scar).toHaveAccessibleDescription(/Scorched by wildfire/);
  const flames = map.locator('[data-disaster="fire"]');
  await expect(flames).toHaveCount(0);
  await active.blur();
  await reviewScreenshot(map.locator(".territoryMapViewport"), {
    path: info.outputPath(`wildfire-map-${theme}.png`),
  });

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(async () => (await diagnostics()).wildfire.time)
    .toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(async () => (await diagnostics()).motionAllowed)
    .toBe(false);
  const frozen = await diagnostics();
  await canvas.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const view = element.ownerDocument.defaultView!;
        view.requestAnimationFrame(() =>
          view.requestAnimationFrame(() => resolve()),
        );
      }),
  );
  expect((await diagnostics()).wildfire.time).toBe(frozen.wildfire.time);

  const contextLoss = await canvas.evaluateHandle((element: MapCanvas) => {
    const loss = element
      .getContext("webgl2")!
      .getExtension("WEBGL_lose_context")!;
    loss.loseContext();
    return loss;
  });
  await expect(canvas).toHaveAttribute("data-renderer", "lost");
  await expect(
    map.locator(
      `[data-tile="${burned}"][data-ground-condition="scorched"] .territoryTerrainArtwork`,
    ),
  ).toBeVisible();
  await expect(flames).toHaveCount(2);
  await expect(flames.first()).toBeVisible();
  await contextLoss.evaluate((loss) => loss.restoreContext());
  await expect(canvas).toHaveAttribute("data-renderer", "ready");
  await expect(flames).toHaveCount(0);
  expect((await diagnostics()).wildfire).toEqual(frozen.wildfire);
});

test("shows extreme cold on terrain and explains the plant derate in both renderers", async ({
  page,
}, info) => {
  const desktop = info.project.name === "desktop-chromium";
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    (theme) => {
      localStorage.setItem("theme", theme);
      localStorage.setItem("audioEnabled", "false");
    },
    desktop ? "light" : "dark",
  );
  await page.goto("/?scenario=116");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const pause = page.getByRole("button", { name: "pause", exact: true });
  await expect(pause).toBeVisible();
  if ((await pause.getAttribute("aria-pressed")) !== "true")
    await pause.click();
  await expect
    .poll(async () => (await readSavedGame(page))?.scenarioId)
    .toBe(116);

  const gasTile = await editSavedGame(page, ({ game }) => {
    const gas = game.facilities.find(
      (facility) => facility.fuel === "Natural Gas",
    )!;
    game.date = getDateFromMinute(12 * 60, game.startingYear);
    game.speed = "PAUSED";
    game.worldEvents.active = [
      {
        key: "review-extreme-cold",
        definitionId: COLD_DEFINITION_ID,
        startsMinute: 0,
        endsMinute: MINUTES_PER_MONTH,
        attributes: { hazard: "EXTREME_COLD", regional: true, minTempC: -24 },
        effects: { facilityOutputMultipliersById: { [gas.id]: 0.7 } },
      },
    ];
    return gas.tileId!;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const map = await returnToTerritoryMap(page);
  const viewport = map.locator(".territoryMapViewport");
  const canvas = map.locator("canvas.territory3DCanvas");
  await expect(canvas).toHaveAttribute("data-renderer", "ready");
  const gas = map.locator(`[data-map-target="${gasTile}"]`);
  await gas.focus();
  await expect(gas).toBeInViewport({ ratio: 0.75 });
  await expect(gas).toHaveAccessibleDescription(/Extreme cold.*70% available/);
  await expect(map.locator("[data-disaster-tile]")).toHaveCount(0);
  await gas.blur();
  await reviewScreenshot(viewport, {
    path: info.outputPath("frost-webgl-map.png"),
  });

  await gas.press("Enter");
  const inspector = page.locator(".tileWorkspaceSurface");
  await expect(
    inspector.getByText("Extreme cold", { exact: true }).first(),
  ).toBeVisible();
  await expect(inspector.getByText("70% available")).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  if (desktop) {
    await reviewScreenshot(page, {
      path: info.outputPath("frost-webgl-inspector.png"),
      clip: { x: 210, y: 104, width: 1068, height: 610 },
    });
  }
  await inspector.getByRole("button", { name: /^Close/ }).click();

  await canvas.evaluate((element: MapCanvas) => {
    element
      .getContext("webgl2")!
      .getExtension("WEBGL_lose_context")!
      .loseContext();
  });
  await expect(canvas).toHaveAttribute("data-renderer", "lost");
  const plantGround = map.locator(
    `[data-tile="${gasTile}"][data-frost="derate"]`,
  );
  const regionalGround = map.locator(
    '[data-frost="regional"] .territoryTerrainArtwork',
  );
  await expect(
    plantGround.locator('.territoryTerrainArtwork path[fill*="frost-cover"]'),
  ).toBeVisible();
  await expect(regionalGround.first()).toBeVisible();
  await expect(map.locator("[data-disaster-tile]")).toHaveCount(0);
  await expect(gas).toHaveAccessibleDescription(/Extreme cold.*70% available/);
  await reviewScreenshot(viewport, {
    path: info.outputPath("frost-svg-map.png"),
  });
});

test("hail falls on the struck solar site and leaves visibly broken panels during repairs", async ({
  page,
}, info) => {
  const desktop = info.project.name === "desktop-chromium";
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    (theme) => {
      localStorage.setItem("theme", theme);
      localStorage.setItem("audioEnabled", "false");
    },
    desktop ? "light" : "dark",
  );
  await page.goto("/?scenario=116");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const pause = page.getByRole("button", { name: "pause", exact: true });
  await expect(pause).toBeVisible();
  if ((await pause.getAttribute("aria-pressed")) !== "true")
    await pause.click();
  await expect
    .poll(async () => (await readSavedGame(page))?.scenarioId)
    .toBe(116);

  const struck = "champlain:site-12";
  const repairing = "champlain:site-13";
  await editSavedGame(page, (save) => {
    loadSimData(save.game.location);
    for (const tileId of [struck, repairing] as const) {
      const facility = getBuildFacilityQuote(
        save.game,
        { name: "Solar", peakW: 6e6 },
        "champlain",
        tileId,
      )!;
      expect(facility?.fuel).toBe("Sun");
      save.game = structuredClone(
        gameReducer(
          save.game,
          buildFacility({
            facility,
            financed: false,
            territoryId: "champlain",
            tileId,
          }),
        ),
      );
      const built = save.game.facilities.find(
        (entry) => entry.tileId === tileId,
      )!;
      expect(built?.fuel).toBe("Sun");
      built.yearsToBuildLeft = 0;
      built.minuteOperational = save.game.date.minute;
    }

    const game = save.game;
    game.date = getDateFromMinute(720, game.startingYear);
    game.speed = "PAUSED";
    game.worldEvents.active = [struck, repairing].map((tileId, index) => {
      const facility = game.facilities.find(
        (entry) => entry.tileId === tileId,
      )!;
      return {
        key: `review-hail:${facility.id}`,
        definitionId: HAIL_DEFINITION_ID,
        startsMinute: game.date.minute - (index ? 90 : 15),
        endsMinute: game.date.minute + 180,
        attributes: { hazard: "HAIL", facilityId: facility.id },
        effects: {
          facilityOutputMultipliersById: { [facility.id]: index ? 0.65 : 0.75 },
        },
      };
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const map = await returnToTerritoryMap(page);
  const canvas = map.locator("canvas.territory3DCanvas");
  await expect(canvas).toHaveAttribute("data-renderer", "ready");
  const fresh = map.locator(`[data-map-target="${struck}"]`);
  await fresh.focus();
  await expect(fresh).toHaveAccessibleDescription(/Hail strike.*75% available/);
  await expect(fresh).toBeInViewport({ ratio: 0.75 });
  await expect(
    map.locator(`[data-map-target="${repairing}"]`),
  ).toHaveAccessibleDescription(/Hail repairs in progress.*65% available/);

  const readRender = (includeScene = false) =>
    canvas.evaluate(
      (element: MapCanvas, inspect) => element.map3DDiagnostics!(inspect),
      includeScene,
    );
  const initial = await readRender(true);
  const hail = initial.scene!.filter(({ id }) => id.startsWith("hail:"));
  expect(hail.map(({ id }) => id)).toEqual([`hail:${struck}`]);
  expect(hail[0].triangles).toBe(12 * 8);
  for (const tileId of [struck, repairing])
    expect(
      initial.scene!.find(({ id }) => id === `structure:${tileId}`)?.modelKey,
    ).toBe("structure:solar-hail-damaged");
  await expect(map.locator('[data-disaster^="hail"]')).toHaveCount(0);
  await fresh.blur();
  await reviewScreenshot(map.locator(".territoryMapViewport"), {
    path: info.outputPath("hail-webgl-map.png"),
  });

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(async () => (await readRender()).phases[`hail:${struck}`])
    .toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => (await readRender()).motionAllowed).toBe(false);
  const held = (await readRender()).phases[`hail:${struck}`];
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect((await readRender()).phases[`hail:${struck}`]).toBe(held);

  await canvas.evaluate((element: MapCanvas) => {
    element
      .getContext("webgl2")!
      .getExtension("WEBGL_lose_context")!
      .loseContext();
  });
  await expect(canvas).toHaveAttribute("data-renderer", "lost");
  await expect(
    map.locator(`[data-disaster-tile="${struck}"] [data-disaster="hail"]`),
  ).toBeVisible();
  await expect(map.locator(`[data-disaster-tile="${repairing}"]`)).toHaveCount(
    0,
  );
  for (const tileId of [struck, repairing])
    await expect(
      map
        .locator(`[data-occupant-tile="${tileId}"] [data-solar-damage]`)
        .first(),
    ).toBeVisible();
  await reviewScreenshot(map.locator(".territoryMapViewport"), {
    path: info.outputPath("hail-svg-map.png"),
  });
});

test("tile inspection shares the desktop window stack", async ({
  page,
}, info) => {
  test.skip(
    page.viewportSize()!.width < 1024,
    "The compact map uses one panel",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/?scenario=116");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const map = await returnToTerritoryMap(page);
  await expect(map.locator("canvas.territory3DCanvas")).toHaveAttribute(
    "data-renderer",
    "ready",
  );
  const capital = map.locator('[data-map-target="champlain:city"]');
  const fleet = page.getByRole("region", { name: "Fleet", exact: true });
  const agreements = page.getByRole("region", {
    name: "Agreements",
    exact: true,
  });
  await page.getByRole("button", { name: "Fleet", exact: true }).click();
  await page.getByRole("button", { name: "Agreements", exact: true }).click();
  const fleetBounds = await fleet.boundingBox();
  const agreementsBounds = await agreements.boundingBox();

  await capital.click();
  const inspector = page.getByRole("dialog", {
    name: "Burlington",
    exact: true,
  });
  await expect(inspector).toBeVisible();
  await expect(fleet).toBeVisible();
  await expect(agreements).toBeVisible();
  await expect(inspector).toHaveAttribute("data-map-window-front", "true");
  await expect(
    inspector.getByRole("heading", { name: "Burlington", exact: true }),
  ).toBeFocused();
  expect(await fleet.boundingBox()).toEqual(fleetBounds);
  expect(await agreements.boundingBox()).toEqual(agreementsBounds);
  await expect(capital).toHaveAttribute("aria-pressed", "true");
  await capital.click({ trial: true });
  await reviewScreenshot(page.locator(".gameStage"), {
    path: info.outputPath("tile-window-stack.png"),
    animations: "disabled",
    scale: "css",
  });

  const sameWindow = await inspector.elementHandle();
  const nextTile = map.locator('[data-map-target="champlain:site-1"]');
  await nextTile.press("Enter");
  await expect(inspector).toHaveCount(0);
  await expect(nextTile).toHaveAttribute("aria-pressed", "true");
  expect(
    await sameWindow!.evaluate(
      (element) => document.querySelector("#tool-TILE") === element,
    ),
  ).toBe(true);
  await capital.click();
  await expect(inspector).toHaveAttribute("data-map-window-front", "true");

  await page.getByRole("button", { name: "Agreements", exact: true }).click();
  await expect(agreements).toHaveAttribute("data-map-window-front", "true");
  await page.keyboard.press("Escape");
  await expect(agreements).toHaveCount(0);
  await expect(inspector).toHaveAttribute("data-map-window-front", "true");
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  await expect(capital).toHaveAttribute("aria-pressed", "false");
  await expect(capital).toBeFocused();
  await expect(fleet).toBeVisible();

  await capital.press("Enter");
  await expect(inspector).toBeVisible();
  await fleet.getByRole("button", { name: "Close Fleet", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(fleet).toHaveCount(0);
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveAttribute("data-map-window-front", "true");
});
