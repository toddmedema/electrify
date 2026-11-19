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
import { getTerritoryTile } from "../src/helpers/TerritoryTiles";
import { getTerrainModel } from "../src/components/base/territory-3d/TerrainModels";
import { readSavedGame } from "./save-fixture";
import { loadSimData } from "../src/testing/SimData";
import {
  projectCatalogue,
  projectSiteCapitalCost,
  projectSiteQuote,
  selectProject,
} from "../src/helpers/ProjectBuild";
import { formatPurchasePrice } from "../src/helpers/Format";
import {
  projectPoint,
  tilePosition3D,
} from "../src/components/base/territory-3d/Projection";

async function readyDiagnostics(canvas: Locator) {
  const read = () =>
    canvas.evaluate((element: MapCanvas) => element.map3DDiagnostics?.(true));
  let diagnostics: Awaited<ReturnType<typeof read>>;
  await expect
    .poll(async () => {
      diagnostics = await read();
      return diagnostics?.drawCalls ?? 0;
    })
    .toBeGreaterThan(5);
  return diagnostics!;
}

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
    const before = await readyDiagnostics(canvas);
    expect(before.triangles).toBeGreaterThan(100);
    expect(before.instanceCount).toBeGreaterThan(10);
    const border = before.scene?.find(({ id }) => id === "border:ownership");
    expect(border?.triangles).toBeGreaterThan(0);
    await expect(map.locator(".territoryHexBoundary")).toHaveCount(0);
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
      await expect(map.locator(".tileWorkspaceSurface")).toHaveCount(0);
      if (theme === "light") {
        // A low-frequency wheel moves the map from half to double its starting scale.
        await page.mouse.move(x, y);
        const baseline = await readTerritoryMapCamera(viewport);
        await page.mouse.wheel(0, -2000);
        await expect
          .poll(async () => (await readTerritoryMapCamera(viewport)).scale)
          .toBe(baseline.scale * 2);
        await page.mouse.wheel(0, 2000);
        await expect
          .poll(async () => (await readTerritoryMapCamera(viewport)).scale)
          .toBe(baseline.scale / 2);
        const camera = await readTerritoryMapCamera(viewport);
        expect(camera.x).toBeCloseTo(baseline.x, 3);
        expect(camera.y).toBeCloseTo(baseline.y, 3);
      }
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
    await expect(map.locator(".territoryHexBoundary").first()).toBeVisible();
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
    const after = await readyDiagnostics(canvas);
    expect(after.frames).toBeGreaterThan(before.frames);
    expect(after.light).toEqual(before.light);
    await expect(map.locator(".territoryMap")).toHaveAttribute(
      "data-buy-mode",
      "true",
    );
  });
}

test("clicking real mountain relief above its ground selects the mountain tile", async ({
  page,
}) => {
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
  await mountain.focus();
  await mountain.press("Escape");
  await expect(mountain).toHaveAttribute("aria-pressed", "false");
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
  test(`connected project site markers fit inside their tiles · ${theme}`, async ({
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
      expect(size.height).toBeLessThanOrEqual(size.tileHeight * 0.75);
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
    const total = formatPurchasePrice(projectSiteCapitalCost(quote));
    await expect(ownedMarker.locator("b")).toHaveText(total);
    await expect(owned).toHaveAccessibleName(
      /Total project cost .*Already connected/,
    );
    await owned.focus();
    await owned.press("Enter");
    await expect(surface.getByText("Connected", { exact: true })).toBeVisible();
    await ownedMarker.hover();
    await expect(map.getByRole("tooltip")).toContainText(
      `Total project cost ${total} · Already connected`,
    );
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
