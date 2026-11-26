import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { pauseBrowserClock } from "./browser-clock";
import type { MapCanvas } from "../src/components/base/territory-3d/Types";
import type { TerritoryTileId } from "../src/Types";
import {
  closeTileSurface,
  readTerritoryMapCamera,
  openMapProjectCatalogue,
  returnToTerritoryMap,
  setMapProjectCapacity,
  showMapFacilityStatus,
} from "./layout";
import { reviewScreenshot } from "./review-screenshot";
import { getBuildFacilityQuote } from "../src/data/Facilities";
import gameReducer, { buildFacility } from "../src/reducers/Game";
import { getTerritoryTile } from "../src/helpers/TerritoryTiles";
import { HEX_HEIGHT } from "../src/components/base/TerritoryHexGeometry";
import { SceneBuilder } from "../src/components/base/territory-3d/SceneBuilder";
import { getStructureModel } from "../src/components/base/territory-3d/StructureModels";
import { territoryTileViews } from "../src/helpers/TerritoryMapState";
import { getTerrainModel } from "../src/components/base/territory-3d/TerrainModels";
import { editSavedGame, readSavedGame } from "./save-fixture";
import { TICK_MINUTES, YEARS_PER_TICK } from "../src/Constants";
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
import { formatPurchasePrice } from "../src/helpers/Format";
import {
  projectPoint,
  tilePosition3D,
} from "../src/components/base/territory-3d/Projection";

async function startPausedMap(
  page: Page,
  theme?: "light" | "dark",
  renderer: "ready" | "unavailable" | "loading" = "ready",
) {
  if (theme)
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
  await expect(
    renderer === "loading" ? map.locator(".territoryMap") : canvas,
  ).toHaveAttribute("data-renderer", renderer);
  return { map, canvas };
}

async function readyDiagnostics(canvas: Locator, scene = false) {
  const read = () =>
    canvas.evaluate(
      (element: MapCanvas, includeScene) =>
        element.map3DDiagnostics?.(includeScene),
      scene,
    );
  let diagnostics: Awaited<ReturnType<typeof read>>;
  await expect
    .poll(async () => {
      diagnostics = await read();
      return diagnostics?.drawCalls ?? 0;
    })
    .toBeGreaterThan(5);
  return diagnostics!;
}

test("Valley town growth survives resume and adds buildings to the map", async ({
  page,
}, info) => {
  const capitalId = "champlain:city";
  await startPausedMap(page, "light");
  async function resumeTown(years: number) {
    await editSavedGame(page, (save) => {
      const game = save.game;
      // Advance the presentation year while keeping the same local time and accounting month.
      game.date = {
        ...getDateFromMinute(720, game.startingYear),
        year: game.startingYear + years,
      };
      game.speed = "PAUSED";
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const map = await returnToTerritoryMap(page);
    const canvas = map.locator("canvas.territory3DCanvas");
    await expect(canvas).toHaveAttribute("data-renderer", "ready");
    const capital = map.locator(`[data-map-target="${capitalId}"]`);
    const diagnostics = await readyDiagnostics(canvas, true);
    const city = diagnostics.scene!.find(
      ({ id }) => id === `structure:${capitalId}`,
    );
    return { map, city, capital };
  }

  const opening = await resumeTown(0);
  expect(opening.city?.modelKey).toBe("structure:city-large");
  await expect(opening.capital).not.toHaveAccessibleDescription(
    /New buildings/,
  );
  await reviewScreenshot(opening.map.locator(".territoryMapViewport"), {
    path: info.outputPath("burlington-opening.png"),
  });

  const grown = await resumeTown(19);
  expect(grown.city?.modelKey).toMatch(
    /^structure:city-large:residential-commercial/,
  );
  expect(grown.city?.triangles).toBeGreaterThan(opening.city!.triangles);
  await expect(grown.capital).toHaveAccessibleDescription(
    /New buildings: homes, shops/,
  );
  await reviewScreenshot(grown.map.locator(".territoryMapViewport"), {
    path: info.outputPath("burlington-grown.png"),
  });
});

test("mobile map tools leave even gutters around the live terrain", async ({
  page,
}, info) => {
  test.skip(!info.project.use.hasTouch, "Requires the compact touch map");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { canvas } = await startPausedMap(page);
  const dock = page.locator("#navfooter");
  const stage = page.locator(".gameStage");

  for (const name of ["Insights", "Events", "Programs"]) {
    await dock.getByRole("button", { name, exact: true }).click();
    const panel = page.getByRole("region", { name, exact: true });
    await expect(panel).toBeVisible();
    await expect(canvas).toHaveAttribute("data-renderer", "ready");
    const [tool, terrain, actions] = await Promise.all([
      panel.boundingBox(),
      stage.boundingBox(),
      dock.boundingBox(),
    ]);
    const left = tool!.x - terrain!.x;
    const right = terrain!.x + terrain!.width - (tool!.x + tool!.width);
    expect(left).toBeCloseTo(right);
    expect(left).toBeGreaterThanOrEqual(4);
    expect(left).toBeLessThanOrEqual(12);
    expect(tool!.y - terrain!.y).toBeGreaterThanOrEqual(4);
    expect(actions!.y - (tool!.y + tool!.height)).toBeGreaterThanOrEqual(4);
  }
});

test("mobile map tools slide in and out and share the Build header", async ({
  page,
}, info) => {
  test.skip(!info.project.use.hasTouch, "Requires the compact touch map");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await startPausedMap(page);
  const dock = page.locator("#navfooter");
  const programs = dock.getByRole("button", { name: "Programs", exact: true });
  const panel = page.getByRole("region", { name: "Programs", exact: true });
  // Capture the browser's keyframes before a busy renderer can skip the slide's
  // frames and clear the animation before transitionstart is delivered.
  const slides = await page.locator(".gameToolTray").evaluateHandle((tray) => {
    const offsets: { from: number; to: number }[] = [];
    const recorded = new WeakSet<Animation>();
    const yOffset = (transform: unknown) => {
      if (transform === "none") return 0;
      return typeof transform === "string"
        ? new DOMMatrix(transform).m42
        : Number.NaN;
    };
    const observer = new MutationObserver(() => {
      const wrapper = tray.querySelector("#tool-PROGRAMS")?.parentElement;
      const slide = wrapper
        ?.getAnimations()
        .find(
          (animation) =>
            animation instanceof CSSTransition &&
            animation.transitionProperty === "transform",
        );
      if (!(slide?.effect instanceof KeyframeEffect) || recorded.has(slide))
        return;
      const [first, last] = slide.effect.getKeyframes();
      recorded.add(slide);
      offsets.push({
        from: yOffset(first.transform),
        to: yOffset(last.transform),
      });
    });
    observer.observe(tray, {
      subtree: true,
      attributeFilter: ["class"],
    });
    return offsets;
  });
  await programs.click();
  await expect.poll(async () => (await slides.jsonValue()).length).toBe(1);
  const [entry] = await slides.jsonValue();
  expect(entry.from).toBeGreaterThan(0);
  expect(entry.to).toBe(0);
  await expect(panel.locator("..")).toHaveCSS("transform", "none");
  const programsHeader = panel.locator(":scope > header");
  const headerStyle = (header: Locator) =>
    header.evaluate((element) => {
      const style = getComputedStyle(element);
      return [
        element.className,
        style.height,
        style.backgroundColor,
        style.padding,
      ];
    });
  const expectedHeader = await headerStyle(programsHeader);
  await programs.click();
  await expect(panel).toHaveCount(0);
  await expect(programs).toBeFocused();
  await expect.poll(async () => (await slides.jsonValue()).length).toBe(2);
  const [, exit] = await slides.jsonValue();
  expect(exit.from).toBe(0);
  expect(exit.to).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await programs.click();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Close Programs" }).click();
  await expect(page.locator("#tool-PROGRAMS")).toHaveCount(0);
  expect(await slides.jsonValue()).toHaveLength(2);
  await slides.dispose();

  const build = await openMapProjectCatalogue(page);
  await expect(
    build.getByRole("tab", { name: "Generators", exact: true }),
  ).toBeVisible();
  expect(await headerStyle(build.locator(":scope > header"))).toEqual(
    expectedHeader,
  );

  await page.emulateMedia({ reducedMotion: "no-preference" });
  const buildTrigger = dock.getByRole("button", { name: "Build", exact: true });
  // Reopen as soon as the browser creates the exit transition, while the same
  // panel is still mounted and its controls are inert.
  const reopen = await buildTrigger.evaluateHandle((button) => {
    if (!(button instanceof HTMLButtonElement))
      throw new Error("Expected the Build dock button");
    const project = document.getElementById("tool-BUILD_GENERATORS")!;
    const wrapper = project.parentElement!;
    const result = { project, reopened: false };
    const observer = new MutationObserver(() => {
      const sliding = wrapper
        .getAnimations()
        .some(
          (animation) =>
            animation instanceof CSSTransition &&
            animation.transitionProperty === "transform",
        );
      if (!wrapper.inert || !sliding) return;
      observer.disconnect();
      button.click();
      result.reopened = true;
    });
    observer.observe(wrapper, { attributeFilter: ["class", "inert"] });
    button.click();
    return result;
  });
  await expect
    .poll(() => reopen.evaluate(({ reopened }) => reopened))
    .toBe(true);
  await expect(
    build.getByRole("heading", { name: "Build", exact: true }),
  ).toBeFocused();
  expect(
    await reopen.evaluate(
      ({ project }) => document.getElementById(project.id) === project,
    ),
  ).toBe(true);
  await reopen.dispose();
});

for (const theme of ["light", "dark"] as const) {
  test(`renders real 3D and recovers a lost context · ${theme}`, async ({
    page,
  }, info) => {
    const { map, canvas } = await startPausedMap(page, theme);
    const before = await readyDiagnostics(canvas, true);
    expect(before.triangles).toBeGreaterThan(100);
    expect(before.instanceCount).toBeGreaterThan(10);
    const border = before.scene?.find(({ id }) => id === "border:ownership");
    expect(border?.triangles).toBeGreaterThan(0);
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
    const contextLoss = await canvas.evaluateHandle((element: MapCanvas) => {
      const gl = element.getContext("webgl2")!;
      const loss = gl.getExtension("WEBGL_lose_context");
      if (!loss)
        throw new Error("Context-loss extension unavailable in test browser");
      loss.loseContext();
      return loss;
    });
    await expect(canvas).toHaveAttribute("data-renderer", "lost");
    const graphicsStatus = map.getByText("3D graphics disconnected.", {
      exact: false,
    });
    await expect(graphicsStatus).toBeVisible();
    await capital.focus();
    await expect(capital).toHaveAttribute("aria-pressed", "true");
    await map
      .getByRole("button", { name: "Rapid connection mode", exact: true })
      .click();
    await expect(map.locator(".territoryMap")).toHaveAttribute(
      "data-buy-mode",
      "true",
    );
    const viewport = map.getByRole("region", {
      name: "Territory map",
      exact: true,
    });
    await expect(
      viewport.locator(".territoryTilePrice").first(),
    ).toBeAttached();
    const noticeBounds = (await graphicsStatus.boundingBox())!;
    const viewportBounds = (await viewport.boundingBox())!;
    expect(noticeBounds.y + noticeBounds.height).toBeLessThanOrEqual(
      viewportBounds.y,
    );
    await contextLoss.evaluate((loss) => loss.restoreContext());
    await expect(canvas).toHaveAttribute("data-renderer", "ready");
    await expect(graphicsStatus).toHaveCount(0);
    await expect(capital.locator(".territoryTileHitArea")).toHaveCSS(
      "pointer-events",
      "auto",
    );
    const after = await readyDiagnostics(canvas);
    expect(after.frames).toBeGreaterThan(before.frames);
    expect(after.light).toEqual(before.light);
    await expect(map.locator(".territoryMap")).toHaveAttribute(
      "data-buy-mode",
      "true",
    );
  });
}

test("resizing keeps the painted terrain and map labels centered at the same zoom", async ({
  page,
}) => {
  const original = page.viewportSize()!;
  await page.clock.install();
  const { map, canvas } = await startPausedMap(page);
  await showMapFacilityStatus(map);
  await readyDiagnostics(canvas);
  const viewport = map.locator(".territoryMapViewport");
  const scale = (await viewport.getAttribute("data-camera-scale"))!;
  await pauseBrowserClock(page);

  const geometry = () =>
    viewport.evaluate((element) => {
      const view = element.getBoundingClientRect();
      const paint = element.querySelector("canvas")!.getBoundingClientRect();
      const stage = element
        .querySelector(".territoryMapStage")!
        .getBoundingClientRect();
      const markers = element
        .querySelector<SVGGElement>(".territoryFacilityStatusLayer > g")!
        .getScreenCTM()!;
      const centerX = view.left + view.width / 2;
      const centerY = view.top + view.height / 2;
      return {
        viewSize: [view.width, view.height],
        paintSize: [paint.width, paint.height],
        paintDrift: Math.hypot(
          paint.left + paint.width / 2 - centerX,
          paint.top + paint.height / 2 - centerY,
        ),
        markerScale: [markers.a, markers.d],
        labelX: stage.left - centerX,
        labelY: stage.top - centerY,
      };
    });
  const initial = await geometry();
  let painted = initial;
  for (const size of [
    { width: 1147, height: 790 },
    { width: 580, height: 670 },
    { width: 630, height: 720 },
    original,
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => (await geometry()).viewSize)
      .not.toEqual(painted.viewSize);
    const frozen = await geometry();
    expect(
      frozen.paintSize,
      "resizing never stretches the previous frame",
    ).toEqual(painted.paintSize);
    expect(frozen.paintDrift).toBeLessThan(1);
    expect(frozen.markerScale).toEqual(initial.markerScale);
    expect(
      Math.hypot(
        frozen.labelX - initial.labelX,
        frozen.labelY - initial.labelY,
      ),
    ).toBeLessThan(1);
    await expect
      .poll(async () => {
        await page.clock.runFor(32);
        const current = await geometry();
        return Math.hypot(
          current.viewSize[0] - current.paintSize[0],
          current.viewSize[1] - current.paintSize[1],
        );
      })
      .toBeLessThan(1);
    await expect(viewport).toHaveAttribute("data-camera-scale", scale);
    painted = await geometry();
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`hovers and pans the rendered map on desktop · ${theme}`, async ({
    page,
  }) => {
    test.skip(
      (page.viewportSize()?.width ?? 1024) < 1024,
      "Desktop pointer controls",
    );
    const { map, canvas } = await startPausedMap(page, theme);
    await readyDiagnostics(canvas);
    const viewport = map.locator(".territoryMapViewport");
    const capital = viewport.locator('[data-map-target="champlain:city"]');
    const hitArea = capital.locator(".territoryTileHitArea");
    const cameraX = (await readTerritoryMapCamera(viewport)).x;
    await hitArea.hover();
    await expect(capital).toHaveAttribute("data-model-hovered", "true");
    await expect(hitArea).toHaveCSS("background-image", /radial-gradient/);
    await expect(map.getByRole("tooltip")).toContainText("Burlington");
    const bounds = (await hitArea.boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(x + 40, y + 20, { steps: 4 });
    await page.mouse.up({ button: "middle" });
    await expect
      .poll(async () => (await readTerritoryMapCamera(viewport)).x)
      .not.toBe(cameraX);
    await expect(page.locator(".tileWorkspaceSurface")).toHaveCount(0);
  });
}

test("desktop wheel zoom keeps the pointer anchored in every rendered frame", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 1024) < 1024,
    "Desktop pointer controls",
  );
  type ProjectionCapture = Window & { mapZoomProjections?: number[][] };
  await page.addInitScript(() => {
    const projections: number[][] = [];
    (window as ProjectionCapture).mapZoomProjections = projections;
    const submit = WebGL2RenderingContext.prototype.uniformMatrix4fv;
    WebGL2RenderingContext.prototype.uniformMatrix4fv = function (...args) {
      if (
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.classList.contains("territory3DCanvas")
      )
        projections.push(Array.from(args[2]));
      submit.apply(this, args);
    };
  });
  const { map, canvas } = await startPausedMap(page, "light");
  await readyDiagnostics(canvas);
  const viewport = map.locator(".territoryMapViewport");
  const paint = (await canvas.boundingBox())!;
  const zoomX = Math.round(paint.x + paint.width / 2) + 180;
  const zoomY = Math.round(paint.y + paint.height / 2) + 105;
  await page.mouse.move(zoomX, zoomY);
  const readProjections = () =>
    page.evaluate(() => (window as ProjectionCapture).mapZoomProjections!);
  const start = await readProjections();
  const baseline = start.at(-1)!;
  const scale = Number(await viewport.getAttribute("data-camera-scale"));

  for (const [delta, zoom] of [
    [-180, Math.exp(0.3)],
    [180, 1],
    [-2000, 2],
    [2000, 44 / HEX_HEIGHT / scale],
  ]) {
    await page.mouse.wheel(0, delta);
    await expect
      .poll(async () => (await readProjections()).at(-1)![0] / baseline[0])
      .toBeCloseTo(zoom, 5);
    await expect
      .poll(async () =>
        Number(await viewport.getAttribute("data-camera-scale")),
      )
      .toBeCloseTo(scale * zoom, 8);
  }

  // Unproject the cursor onto the ground (world Y = 0) in the initial
  // frame, then follow that same point through each WebGL projection.
  const clipX = (2 * (zoomX - paint.x)) / paint.width - 1;
  const clipY = 1 - (2 * (zoomY - paint.y)) / paint.height;
  const worldX = (clipX - baseline[12]) / baseline[0];
  const worldZ = (clipY - baseline[13]) / baseline[9];
  for (const matrix of (await readProjections()).slice(start.length)) {
    const driftX =
      ((worldX * matrix[0] + matrix[12] - clipX) * paint.width) / 2;
    const driftY =
      ((worldZ * matrix[9] + matrix[13] - clipY) * paint.height) / 2;
    expect(
      Math.hypot(driftX, driftY),
      "terrain drift in CSS pixels",
    ).toBeLessThan(1);
  }
});

test("minimum zoom keeps clicks aligned to the painted hex boundary", async ({
  page,
  isMobile,
}) => {
  const { map, canvas } = await startPausedMap(page);
  await readyDiagnostics(canvas);
  const viewport = map.getByRole("region", { name: "Territory map" });
  const before = await readTerritoryMapCamera(viewport);
  const city = viewport.locator('[data-map-target="champlain:city"]');
  const neighbor = viewport.locator('[data-map-target="champlain:site-2"]');
  await city.locator(".territoryTileHitArea").hover();
  await page.mouse.wheel(0, 2000);
  await expect
    .poll(async () => (await readTerritoryMapCamera(viewport)).scale)
    .toBeLessThan(before.scale * 0.7);

  // Neighboring center points meet halfway across their shared slanted edge.
  const a = (await city.boundingBox())!;
  const b = (await neighbor.boundingBox())!;
  const edge = {
    x: (a.x + a.width / 2 + b.x + b.width / 2) / 2,
    y: (a.y + a.height / 2 + b.y + b.height / 2) / 2,
  };
  const neighborPoint = { x: edge.x, y: edge.y - 1 };
  const cityPoint = { x: edge.x, y: edge.y + 1 };
  const hits = await page.evaluate(
    (points) =>
      points.map(({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest("[data-map-target]")
          ?.getAttribute("data-map-target"),
      ),
    [neighborPoint, cityPoint],
  );
  expect(hits).toEqual(["champlain:site-2", "champlain:city"]);

  if (isMobile) await page.touchscreen.tap(neighborPoint.x, neighborPoint.y);
  else await page.mouse.click(neighborPoint.x, neighborPoint.y);
  await expect(neighbor).toHaveAttribute("aria-pressed", "true");
  await expect(city).toHaveAttribute("aria-pressed", "false");
});

test("pinch zooms the 3D map without magnifying the page", async ({
  page,
  isMobile,
}) => {
  const { map, canvas } = await startPausedMap(page, "light");
  await readyDiagnostics(canvas);
  const viewport = map.locator(".territoryMapViewport");
  const baseline = await readTerritoryMapCamera(viewport);
  const pageScale = await page.evaluate(() => window.visualViewport!.scale);
  const center = await viewport.evaluate((element) => {
    const { left, top } = element.getBoundingClientRect();
    return {
      x: left + element.clientWidth / 2,
      y: top + element.clientHeight / 2,
    };
  });
  const x = Math.round(center.x) - 56;
  const y = Math.round(center.y) + 40;
  const groundAtPinch = ({
    x: cameraX,
    y: cameraY,
    scale,
  }: typeof baseline) => ({
    x: cameraX + (x - center.x) / scale,
    y: cameraY + (y - center.y) / scale,
  });
  const input = await page.context().newCDPSession(page);

  if (isMobile) {
    await input.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: x - 24, y, id: 1 },
        { x: x + 24, y, id: 2 },
      ],
    });
    await input.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 42, y, id: 1 },
        { x: x + 42, y, id: 2 },
      ],
    });
    await input.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } else {
    // Chromium exposes trackpad pinches as cancelable control-wheel events.
    await input.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      modifiers: 2,
      deltaX: 0,
      deltaY: -120,
    });
  }

  await expect
    .poll(async () => (await readTerritoryMapCamera(viewport)).scale)
    .toBeGreaterThan(baseline.scale);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(
    pageScale,
  );
  await expect(page.locator(".tileWorkspaceInspector")).toHaveCount(0);

  const camera = await readTerritoryMapCamera(viewport);
  const beforePinch = groundAtPinch(baseline);
  const afterPinch = groundAtPinch(camera);
  const drift = Math.hypot(
    afterPinch.x - beforePinch.x,
    afterPinch.y - beforePinch.y,
  );
  // Allow one CSS pixel for input-coordinate rounding.
  expect(drift * camera.scale).toBeLessThan(1);

  if (isMobile) {
    await input.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 3 }],
    });
    await input.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 40, y: y + 16, id: 3 }],
    });
    await input.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(async () => (await readTerritoryMapCamera(viewport)).x)
      .toBeLessThan(camera.x);
  }
});

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
      await pauseBrowserClock(page);
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
      const inspector = page.getByRole("dialog", {
        name: "Burlington",
        exact: true,
      });
      await expect(inspector).toBeVisible();
      await expect(
        inspector.getByRole("button", { name: "Close tile" }),
      ).toHaveCount(0);

      if (phone) {
        const corner = await inspector.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const map = element.parentElement!.getBoundingClientRect();
          return { top: box.top - map.top, right: map.right - box.right };
        });
        expect(corner).toEqual({ top: 8, right: 8 });
        const distanceFromCenter = await capital.evaluate((element) => {
          const tile = element.getBoundingClientRect();
          const map = element
            .closest(".territoryMapViewport")!
            .getBoundingClientRect();
          return Math.hypot(
            tile.x + tile.width / 2 - map.x - map.width / 2,
            tile.y + tile.height / 2 - window.innerHeight / 2,
          );
        });
        expect(distanceFromCenter).toBeLessThan(1);
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
      if (info.project.use.hasTouch) await label.tap();
      else await label.click();
      await expect(inspector).toHaveCount(0);
      await expect(capital).toHaveAttribute("aria-pressed", "false");
    },
  );
}

async function nearestUnownedMountain(map: Locator) {
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
  return { mountain, tile: getTerritoryTile(mountainId)! };
}

test("keyboard selection draws a centered 3D mountain outline and Escape clears it", async ({
  page,
}, info) => {
  const { map, canvas } = await startPausedMap(page);
  const { mountain, tile } = await nearestUnownedMountain(map);
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
  const renderedSelection = () =>
    canvas.evaluate((element: MapCanvas) =>
      element
        .map3DDiagnostics?.(true)
        .scene?.find(({ id }) => id === "border:selection"),
    );
  let selection: Awaited<ReturnType<typeof renderedSelection>>;
  // Six edges with two backed dashes each. Each dash has two triangles per layer.
  await expect
    .poll(
      async () => {
        selection = await renderedSelection();
        return selection?.triangles;
      },
      {
        message: "The 3D scene submits a complete six-edge selection outline",
      },
    )
    .toBe(48);
  const origin = tilePosition3D(tile);
  for (const axis of [0, 2] as const)
    expect((selection!.min[axis] + selection!.max[axis]) / 2).toBeCloseTo(
      origin[axis],
    );
  await mountain.press("Escape");
  await expect(mountain).toHaveAttribute("aria-pressed", "false");
  await expect.poll(renderedSelection).toBeUndefined();
  await expect(
    map.getByRole("button", { name: "Rapid connection mode", exact: true }),
  ).toBeFocused();
});

test("clicking projected mountain relief follows the hex under the pointer", async ({
  page,
}) => {
  const { map, canvas } = await startPausedMap(page);
  const tile = getTerritoryTile("frontier:0:-5")!;
  const mountain = map.locator(`[data-map-target="${tile.id}"]`);
  const groundId = "frontier:1:-6";
  const ground = map.locator(`[data-map-target="${groundId}"]`);
  await expect(mountain).toHaveAttribute("data-owned", "false");
  // Reveal the same tile on compact viewports before testing pointer picking.
  await mountain.focus();
  await mountain.press("Escape");
  await expect(mountain).toHaveAttribute("aria-pressed", "false");
  const origin = tilePosition3D(tile);
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
  const views = territoryTileViews((await readSavedGame(page))!);
  const site = views.find((v) => v.tile.id === tile.id)!;
  const [terrain] = new SceneBuilder({
    terrain: getTerrainModel,
    structure: getStructureModel,
  }).build(
    [site],
    views.map((v) => v.tile),
    [],
    0,
    "run",
  );
  const diagnostics = await readyDiagnostics(canvas, true);
  const rendered = diagnostics.scene?.find(({ id }) => id === terrain.id);
  expect(rendered?.modelKey).toBe(terrain.model.key);
  expect(rendered?.max[1]).toBeGreaterThan(0);
  const mesh = terrain.model.parts[1].mesh.positions;
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
  const point = projectPoint(
    [origin[0] + peak[0], peak[1], origin[2] + peak[2]],
    frame,
  );
  const bounds = (await viewport.boundingBox())!;
  const click = { x: bounds.x + point.x, y: bounds.y + point.y };
  // This peak projects into the hit area of its neighbor in the next row.
  const groundAtPeak = await page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest(".territoryTileHitArea")
        ?.closest<HTMLElement>("[data-map-target]")?.dataset.mapTarget,
    click,
  );
  expect(point.x).toBeGreaterThan(0);
  expect(point.x).toBeLessThan(width);
  expect(point.y).toBeGreaterThan(0);
  expect(point.y).toBeLessThan(height);
  expect(groundAtPeak).toBe(groundId);
  await page.mouse.click(click.x, click.y);
  await expect(ground).toHaveAttribute("aria-pressed", "true");
  await expect(mountain).toHaveAttribute("aria-pressed", "false");
  const surface = page.locator(".tileWorkspaceSurface");
  await closeTileSurface(surface);
  await expect(surface).toBeHidden();
  const hitArea = mountain.locator(".territoryTileHitArea");
  // The neighboring utility label can cover the center of this hex.
  const position = await hitArea.evaluate(({ clientWidth, clientHeight }) => ({
    x: clientWidth / 2,
    y: clientHeight * 0.8,
  }));
  await hitArea.click({ position });
  await expect(mountain).toHaveAttribute("aria-pressed", "true");
  await expect(ground).toHaveAttribute("aria-pressed", "false");
  await expect(surface).toBeVisible();
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
      .getByRole("button", { name: /^(Choose sites|Pick site) for Wind$/ })
      .click();
    await expect(
      surface.getByText("Choose a highlighted site.", { exact: true }),
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
    await expect(map.getByRole("tooltip")).toContainText(
      `Total project cost ${total} · Already connected`,
    );
    await map.getByRole("button", { name: "Rapid connection mode" }).focus();
    await expect(map.getByRole("tooltip")).toHaveCount(0);
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

test("explains when WebGL2 cannot start and keeps the tile controls usable", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const mobile = info.project.name.startsWith("mobile-");
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
  const { map } = await startPausedMap(
    page,
    mobile ? "dark" : "light",
    "unavailable",
  );
  const notice = map.getByRole("status", { name: "3D map" });
  await expect(notice).toHaveText(
    "The 3D map is unavailable. WebGL2 is required.",
  );
  const capital = map.getByRole("button", {
    name: "Inspect You territory · Burlington",
  });
  await expect(map.getByRole("button", { name: "Reload page" })).toHaveCount(0);
  const tile = map.locator('[data-map-target="champlain:site-13"]');
  const hitArea = tile.locator(".territoryTileHitArea");
  await expect(tile.locator("strong, .territoryTilePrice")).toHaveCount(0);
  if (mobile) await hitArea.tap({ timeout: 5_000 });
  else await hitArea.click({ timeout: 5_000 });
  const inspector = page.locator(".tileWorkspaceSurface");
  await expect(inspector).toHaveAccessibleName("Plains");
  await closeTileSurface(inspector);

  await capital.press("Enter");
  await expect(inspector).toHaveAccessibleName("Burlington");
  const label = capital.getByText("Burlington", { exact: true });
  if (mobile) {
    const labelBounds = (await label.boundingBox())!;
    const inspectorBounds = (await inspector.boundingBox())!;
    const noticeBounds = (await notice.boundingBox())!;
    expect(noticeBounds.y + noticeBounds.height).toBeLessThanOrEqual(
      inspectorBounds.y,
    );
    expect(inspectorBounds.y + inspectorBounds.height).toBeLessThanOrEqual(
      labelBounds.y,
    );
  }
  await reviewScreenshot(map, {
    path: info.outputPath("map-webgl2-unavailable.png"),
  });
  if (mobile) {
    await label.tap();
    await expect(inspector).toHaveCount(0);
  }
});

test.describe("scene delivery", () => {
  test.use({ serviceWorkers: "block" });

  test("reloads a failed scene while a tile inspector is open", async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const sceneChunk = "**/static/js/territory-scene.*.js";
    let releaseScene!: () => void;
    const pendingScene = new Promise<void>((resolve) => {
      releaseScene = resolve;
    });
    await page.route(sceneChunk, async (route) => {
      await pendingScene;
      await route.abort();
    });
    const { map } = await startPausedMap(page, "dark", "loading");
    const notice = map.getByRole("status", { name: "3D map" });
    await expect(notice).toHaveText("Loading 3D map…");
    await map.locator('[data-map-target="champlain:city"]').press("Enter");
    const inspector = page.getByRole("dialog", { name: "Burlington" });
    const inspectorTop = async () => (await inspector.boundingBox())!.y;
    const loadingTop = await inspectorTop();
    releaseScene();

    await expect(notice).toHaveText("The 3D map couldn’t load.");
    // The Reload control makes the status row taller than the loading message.
    await expect.poll(inspectorTop).toBeGreaterThan(loadingTop);
    const reload = map.getByRole("button", { name: "Reload page" });
    const reloadBounds = (await reload.boundingBox())!;
    expect(reloadBounds.y + reloadBounds.height).toBeLessThanOrEqual(
      await inspectorTop(),
    );
    await reviewScreenshot(map, {
      path: info.outputPath("map-scene-reload.png"),
    });

    await expect(
      page.locator("#appbar:visible [data-save-state]").first(),
    ).toHaveAttribute("data-save-state", "saved");
    await page.unroute(sceneChunk);
    const navigated = page.waitForEvent("framenavigated", {
      predicate: (frame) => frame === page.mainFrame(),
    });
    if (info.project.use.hasTouch) await reload.tap();
    else await reload.click();
    await navigated;
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const restored = await returnToTerritoryMap(page);
    await expect(restored.locator("canvas.territory3DCanvas")).toHaveAttribute(
      "data-renderer",
      "ready",
    );
  });
});

async function dragWindow(page: Page, target: Locator, dx: number, dy: number) {
  const { x, y, width, height } = (await target.boundingBox())!;
  const startX = x + width / 2;
  const startY = y + height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 5 });
  await page.mouse.up();
}

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
    await expect(fleet.locator(".mapWindowResizeEdge")).toHaveCount(0);
    await agreementsAction.click();
    await expect(agreements).toBeVisible();
    await expect(fleet).toHaveCount(0);
    await expect(map).toBeVisible();
    return;
  }

  const title = fleet.getByRole("heading", { name: "Fleet", exact: true });
  const edge = (direction: string) =>
    fleet.locator(`.mapWindowResizeEdge[data-edge="${direction}"]`);
  const resize = edge("se");
  for (const [direction, cursor] of Object.entries({
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    nw: "nwse-resize",
    se: "nwse-resize",
  })) {
    await expect(edge(direction)).toHaveCSS("cursor", cursor);
  }
  const initial = (await fleet.boundingBox())!;
  const camera = await readTerritoryMapCamera(
    map.locator(".territoryMapViewport"),
  );
  await dragWindow(page, title, -144, 48);
  const moved = { ...initial, x: initial.x - 144, y: initial.y + 48 };
  await expect.poll(() => fleet.boundingBox()).toEqual(moved);

  await dragWindow(page, edge("w"), -16, 0);
  await expect
    .poll(() => fleet.boundingBox())
    .toEqual({
      ...moved,
      x: moved.x - 16,
      width: moved.width + 16,
    });
  await dragWindow(page, edge("w"), 16, 0);
  await expect.poll(() => fleet.boundingBox()).toEqual(moved);

  await dragWindow(page, edge("n"), 0, -16);
  await expect
    .poll(() => fleet.boundingBox())
    .toEqual({
      ...moved,
      y: moved.y - 16,
      height: moved.height + 16,
    });
  await dragWindow(page, edge("n"), 0, 16);
  await expect.poll(() => fleet.boundingBox()).toEqual(moved);
  await dragWindow(page, resize, 64, 48);
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
  await title.press("Shift+ArrowRight");
  await page.setViewportSize(viewport);
  await expect.poll(() => fleet.boundingBox()).toEqual(saved);

  await startMap();
  await fleetAction.click();
  await expect.poll(() => fleet.boundingBox()).toEqual(saved);
  await title.press("ArrowLeft");
  await title.press("Shift+ArrowLeft");
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
        const tray = element.offsetParent;
        if (!(tray instanceof HTMLElement))
          throw new Error(
            "Expected a containing layout box for the Fleet window",
          );
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
  await dragWindow(page, resize, -32, 0);
  await expect.poll(horizontalBounds).toEqual({
    left: clamped.left,
    width: clamped.width - 32,
  });
});

test("shows an advancing wildfire and scar on the 3D map", async ({
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
  await contextLoss.evaluate((loss) => loss.restoreContext());
  await expect(canvas).toHaveAttribute("data-renderer", "ready");
  expect((await diagnostics()).wildfire).toEqual(frozen.wildfire);
});

test("shows extreme cold on the 3D map and explains the plant derate", async ({
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
  await closeTileSurface(inspector);
});

test("solar assembly resumes at its saved stage and adds panels as the clock advances", async ({
  page,
}, info) => {
  await page.emulateMedia({
    reducedMotion: info.project.use.hasTouch ? "reduce" : "no-preference",
  });
  await startPausedMap(page, info.project.use.hasTouch ? "dark" : "light");
  const site = "champlain:site-12";
  await editSavedGame(page, (save) => {
    loadSimData(save.game.location);
    const facility = getBuildFacilityQuote(
      save.game,
      { name: "Solar", peakW: 6e6 },
      "champlain",
      site,
    )!;
    save.game = structuredClone(
      gameReducer(
        save.game,
        buildFacility({
          facility,
          financed: false,
          territoryId: "champlain",
          tileId: site,
        }),
      ),
    );
    const solar = save.game.facilities.find(({ tileId }) => tileId === site)!;
    solar.yearsToBuildLeft = solar.yearsToBuild / 2 + YEARS_PER_TICK / 2;
    save.game.speed = "PAUSED";
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const map = await returnToTerritoryMap(page);
  const canvas = map.locator("canvas.territory3DCanvas");
  await expect(canvas).toHaveAttribute("data-renderer", "ready");
  const target = map.locator(`[data-map-target="${site}"]`);
  await target.focus();
  await expect(target).toHaveAccessibleDescription(/Under construction/);
  await expect(target).toBeInViewport({ ratio: 0.75 });
  const readPlant = async () =>
    (await readyDiagnostics(canvas, true)).scene!.find(
      ({ id }) => id === `structure:${site}`,
    );
  const rails = await readPlant();
  expect(rails).toMatchObject({
    modelKey: "structure:solar:small:construction:1",
    active: false,
  });
  await target.blur();
  const viewport = map.locator(".territoryMapViewport");
  if (process.env.REVIEW_SCREENSHOT_DIR && !info.project.use.hasTouch) {
    const { x, y, width, height } = (await target.boundingBox())!;
    const { scale } = await readTerritoryMapCamera(viewport);
    await page.mouse.move(x + width / 2, y + height / 2);
    await page.mouse.wheel(0, -1200);
    await expect
      .poll(async () => (await readTerritoryMapCamera(viewport)).scale)
      .toBeGreaterThan(scale * 1.8);
    await page.getByRole("button", { name: "pause", exact: true }).hover();
  }
  await reviewScreenshot(viewport, {
    path: info.outputPath("solar-racks.png"),
  });

  await page.getByRole("button", { name: "slow speed", exact: true }).click();
  await expect
    .poll(async () => (await readPlant())?.modelKey)
    .toBe("structure:solar:small:construction:2");
  await page.getByRole("button", { name: "pause", exact: true }).click();
  const panels = await readPlant();
  expect(panels).toMatchObject({ active: false, producing: false });
  expect(panels!.triangles).toBeGreaterThan(rails!.triangles);
  await expect(target).toHaveAccessibleDescription(/Under construction/);
  await reviewScreenshot(viewport, {
    path: info.outputPath("solar-installation.png"),
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
    ).toBe("structure:solar-hail-damaged:small");
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
  const heading = inspector.getByRole("heading", {
    name: "Burlington",
    exact: true,
  });
  await expect(heading).toBeFocused();
  await expect(
    inspector.getByRole("button", { name: "Close tile" }),
  ).toHaveCount(0);
  await expect(inspector.locator(".mapWindowResizeEdge")).toHaveCount(0);
  const placement = await inspector.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const tray = element.parentElement!.getBoundingClientRect();
    return {
      right: tray.right - box.right,
      top: box.top - tray.top,
      width: box.width,
      height: box.height,
      availableWidth: tray.width,
      availableHeight: tray.height,
    };
  });
  expect(placement.right).toBe(0);
  expect(placement.top).toBe(0);
  expect(placement.width).toBeLessThanOrEqual(placement.availableWidth);
  expect(placement.height).toBeLessThanOrEqual(placement.availableHeight);
  await expect
    .poll(() =>
      inspector
        .locator(".tileWorkspaceBody")
        .evaluate((body) => body.scrollHeight - body.clientHeight),
    )
    .toBeLessThanOrEqual(1);
  expect(await fleet.boundingBox()).toEqual(fleetBounds);
  expect(await agreements.boundingBox()).toEqual(agreementsBounds);
  await expect(capital).toHaveAttribute("aria-pressed", "true");
  await capital.click({ trial: true });
  await reviewScreenshot(page.locator(".gameStage"), {
    path: info.outputPath("tile-window-stack.png"),
    animations: "disabled",
    scale: "css",
  });

  const fixedBounds = await inspector.boundingBox();
  await dragWindow(page, heading, -64, 40);
  expect(await inspector.boundingBox()).toEqual(fixedBounds);
  const sameWindow = await inspector.elementHandle();
  const nextTile = map.locator('[data-map-target="champlain:site-13"]');
  await nextTile.press("Enter");
  await expect(inspector).toHaveCount(0);
  await expect(nextTile).toHaveAttribute("aria-pressed", "true");
  expect(
    await sameWindow!.evaluate(
      (element) => document.querySelector("#tool-TILE") === element,
    ),
  ).toBe(true);
  const emptyInspector = page.getByRole("dialog", {
    name: "Plains",
    exact: true,
  });
  await expect(emptyInspector).toBeVisible();
  await expect
    .poll(() =>
      emptyInspector.evaluate(
        (element, width) => width / element.getBoundingClientRect().width,
        placement.width,
      ),
    )
    .toBeCloseTo(1.3, 1);
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
  await map.getByRole("region", { name: "Territory map", exact: true }).click({
    position: { x: 4, y: 4 },
  });
  await expect(inspector).toHaveCount(0);
});
