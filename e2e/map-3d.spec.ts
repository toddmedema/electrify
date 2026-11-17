import { expect, test } from "./fixtures";
import type { MapCanvas } from "../src/components/base/territory-3d/Types";
import { returnToTerritoryMap } from "./layout";
import { reviewScreenshot } from "./review-screenshot";
import { getTerritoryTile } from "../src/helpers/TerritoryTiles";
import { getTerrainModel } from "../src/components/base/territory-3d/TerrainModels";
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
    ).toBeVisible();
    await expect(page.locator(".gridStatusButton:visible")).toContainText(
      /NOW.*[kMGT]?W/,
    );
    await reviewScreenshot(map, {
      path: info.outputPath(`map-3d-${theme}.png`),
    });
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
    .locator('[data-map-target][data-terrain="mountain"]')
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
  const frame = await viewport.evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
    cameraX: Number(element.getAttribute("data-camera-x")),
    cameraY: Number(element.getAttribute("data-camera-y")),
    scale: Number(element.getAttribute("data-camera-scale")),
  }));
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
  expect(ground).toBeTruthy();
  expect(ground).not.toBe(tile.id);
  await page.mouse.click(click.x, click.y);
  await expect(mountain).toHaveAttribute("aria-pressed", "true");
});

for (const theme of ["light", "dark"] as const) {
  test(`connected project site markers fit on one line · ${theme}`, async ({
    page,
  }, info) => {
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
    await map.getByRole("button", { name: "Build", exact: true }).click();
    const surface = page.locator(".tileWorkspaceSurface");
    await surface
      .getByRole("button", { name: "Choose sites for Wind", exact: true })
      .click();
    await expect(
      surface.getByText("Connected · free site", { exact: true }),
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
    await expect(markers.first()).toHaveAttribute(
      "title",
      "Connected · free site",
    );
    await expect(
      map.locator('[data-project-site="owned"]').first(),
    ).toHaveAccessibleName(/Connected · free site/);
    const owned = map.locator('[data-project-site="owned"]').first();
    await owned.focus();
    await owned.press("Enter");
    await expect(surface.getByText("Already connected · $0")).toBeVisible();
    const ownedMarker = owned.locator(".territoryTilePrice");
    await ownedMarker.hover();
    await expect(ownedMarker).toHaveAttribute("title", "Connected · free site");
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
  await map.getByRole("button", { name: "Build", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Plan a project", exact: true }),
  ).toBeVisible();
});
