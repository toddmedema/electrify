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
      await expect(map.locator(".tileWorkspaceSurface")).toHaveCount(0);
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
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 200);
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
