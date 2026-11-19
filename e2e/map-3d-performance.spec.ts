import type { Page, Locator } from "@playwright/test";
import fs from "node:fs";
import type { TerritoryTileDefinition } from "../src/data/TerritoryTiles";
import type { MapCanvas } from "../src/components/base/territory-3d/Types";
import { hexCenter } from "../src/components/base/TerritoryHexGeometry";
import { getTerritoryTile } from "../src/helpers/TerritoryTiles";
import { territoryTileViews } from "../src/helpers/TerritoryMapState";
import { expect, test } from "./fixtures";
import { readTerritoryMapCamera, returnToTerritoryMap } from "./layout";
import { readSavedGame, readSaveRecords } from "./save-fixture";
import { reviewScreenshot } from "./review-screenshot";

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
  const map = await returnToTerritoryMap(page);
  const canvas = map.locator("canvas.territory3DCanvas");
  await expect(canvas).toHaveAttribute("data-renderer", "ready");
  const saved = page.locator("#appbar:visible [data-save-state]").first();
  await expect(saved).toHaveAttribute("data-save-state", "saved");
  const id = await saved.getAttribute("data-active-save-id");
  await expect
    .poll(async () =>
      (await readSaveRecords(page)).some(
        (record) => record.metadata.id === id && record.save !== undefined,
      ),
    )
    .toBe(true);
  return { map, canvas, pause };
}

const sample = (canvas: Locator, scene = false) =>
  canvas.evaluate(
    (element: MapCanvas, includeScene) =>
      element.map3DDiagnostics!(includeScene),
    scene,
  );

async function panTo(
  page: Page,
  map: Locator,
  tile: Pick<TerritoryTileDefinition, "q" | "r">,
) {
  const viewport = map.locator(".territoryMapViewport"),
    target = hexCenter(tile);
  for (let attempt = 0; attempt < 20; attempt++) {
    const camera = await readTerritoryMapCamera(viewport);
    const dx = (camera.x - target.x) * camera.scale,
      dy = (camera.y - target.y) * camera.scale;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const box = (await viewport.boundingBox())!,
      step = Math.min(
        1,
        (box.width * 0.3) / Math.max(1, Math.abs(dx)),
        (box.height * 0.25) / Math.max(1, Math.abs(dy)),
      );
    const x = box.x + box.width / 2,
      y = box.y + box.height * 0.35;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y);
    await page.mouse.move(x + dx * step, y + dy * step, { steps: 4 });
    await page.mouse.up();
  }
  throw new Error(`Cannot reach map tile ${tile.q},${tile.r}`);
}

for (const theme of ["light", "dark"] as const) {
  test(`real 3D phases follow operation, speed, visibility and simulated light · ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const { map, canvas, pause } = await startMap(page, theme);
    const game = (await readSavedGame(page))!;
    const wind = game.facilities.find(
      (facility) => facility.fuel === "Wind" && facility.currentW > 0,
    )!;
    expect(wind).toBeDefined();
    await panTo(page, map, getTerritoryTile(wind.tileId, game)!);
    const target = map.locator(`[data-map-target="${wind.tileId}"]`);
    await target.focus();
    await target.press("Enter");
    const surface = page.locator(".tileWorkspaceSurface");
    await expect(surface).toBeVisible();
    const windScene = (await sample(canvas, true)).scene!.find(
      (instance) => instance.id === `structure:${wind.tileId}`,
    )!;
    expect(windScene).toMatchObject({
      active: true,
      modelKey: "structure:wind",
    });
    expect(windScene.triangles).toBeGreaterThan(0);
    const key = windScene.motionKey!;
    expect(key).toContain(`facility:${wind.id}`);
    const initial = await sample(canvas);
    expect(initial.playbackRate).toBe(0.25);
    await expect
      .poll(async () => (await sample(canvas)).phases[key])
      .not.toBe(initial.phases[key]);
    expect((await sample(canvas)).light).toEqual(initial.light);
    await surface.getByRole("button", { name: /^Pause / }).click();
    await expect
      .poll(
        async () =>
          (await sample(canvas, true)).scene!.find(
            (instance) => instance.id === windScene.id,
          )!.active,
      )
      .toBe(false);
    const stopped = await sample(canvas);
    await page.waitForTimeout(180);
    expect((await sample(canvas)).phases[key]).toBe(stopped.phases[key]);
    const paused = (await readSavedGame(page))!.facilities.find(
      (facility) => facility.id === wind.id,
    )!;
    expect(paused.paused).toBe(true);
    expect(paused.currentW).toBeGreaterThan(0);
    await surface.getByRole("button", { name: /^Resume / }).click();
    await expect
      .poll(async () => (await sample(canvas)).phases[key])
      .not.toBe(stopped.phases[key]);
    const resumedPhase = (await sample(canvas)).phases[key];
    expect(
      (resumedPhase - stopped.phases[key] + Math.PI * 2) % (Math.PI * 2),
    ).toBeLessThan(0.5);
    await surface
      .getByRole("button", { name: "Close tile", exact: true })
      .click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(async () => (await sample(canvas)).motionAllowed)
      .toBe(false);
    const reduced = await sample(canvas);
    await page.waitForTimeout(180);
    expect((await sample(canvas)).phases[key]).toBe(reduced.phases[key]);
    await expect(
      map.locator(`[data-occupant-tile="${wind.tileId}"]`),
    ).toHaveAttribute("data-facility-status", "producing");
    // Retiming while reduced motion freezes the exact phase: neither speed nor scene updates reset it.
    const rates: [string, number][] = [
      ["slow speed", 0.7],
      ["normal speed", 1],
      ["fast speed", 1.2],
      ["pause", 0.25],
    ];
    // Reach the existing 1300 px 24× breakpoint through the actual responsive UI.
    const originalViewport = page.viewportSize()!;
    if (originalViewport.width >= 700)
      await page.setViewportSize({ ...originalViewport, width: 1440 });
    const ultra = page.getByRole("button", {
      name: "ultra speed",
      exact: true,
    });
    await expect(ultra).toHaveCount(originalViewport.width >= 700 ? 1 : 0);
    if (originalViewport.width >= 700)
      rates.splice(rates.length - 1, 0, ["ultra speed", 1.5]);
    for (const [label, rate] of rates) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect
        .poll(async () => (await sample(canvas)).playbackRate)
        .toBe(rate);
      expect((await sample(canvas)).phases[key]).toBe(reduced.phases[key]);
    }
    await page.setViewportSize(originalViewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect
      .poll(async () => (await sample(canvas)).motionAllowed)
      .toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await sample(canvas)).visible).toBe(false);
    const hidden = await sample(canvas);
    await page.waitForTimeout(180);
    expect((await sample(canvas)).phases).toEqual(hidden.phases);
    expect((await sample(canvas)).frames).toBe(hidden.frames);
    expect((await sample(canvas)).light).toEqual(hidden.light);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect
      .poll(async () => (await sample(canvas)).frames)
      .toBeGreaterThan(hidden.frames);
    const foreign = territoryTileViews(game).find(
      (view) => !view.owned && view.facility,
    )!;
    expect(foreign).toBeDefined();
    await panTo(page, map, foreign.tile);
    const foreignScene = (await sample(canvas, true)).scene!.find(
      (instance) => instance.id === `structure:${foreign.tile.id}`,
    )!;
    expect(foreignScene.active).toBe(false);
    expect(foreignScene.motionKey).toBeUndefined();
    const light = (await sample(canvas)).light;
    await page.getByRole("button", { name: "fast speed", exact: true }).click();
    await expect
      .poll(async () => (await sample(canvas)).light)
      .not.toEqual(light);
    // Slow the actual simulation before choosing the review instant, so browser input latency
    // cannot carry 12× game time several hours beyond the observed sunlight.
    await page.getByRole("button", { name: "slow speed", exact: true }).click();
    await expect
      .poll(
        async () => {
          const current = await sample(canvas);
          return current.light[1] > 0.92 && current.lightColor[0] > 0.99;
        },
        { timeout: 25000 },
      )
      .toBe(true);
    await pause.click();
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    const frozen = (await sample(canvas)).light;
    await page.waitForTimeout(180);
    expect((await sample(canvas)).light).toEqual(frozen);
    await panTo(page, map, getTerritoryTile("champlain:city", game)!);
    const actualDate = (await readSavedGame(page))!.date;
    expect(actualDate.minuteOfDay).toBeGreaterThan(540);
    expect(actualDate.minuteOfDay).toBeLessThan(900);
    const datePath = info.outputPath("daylight-map-time.json");
    fs.writeFileSync(datePath, JSON.stringify(actualDate, null, 2));
    await info.attach("daylight-map-time", {
      path: datePath,
      contentType: "application/json",
    });
    await reviewScreenshot(map, {
      path: info.outputPath(`daylight-map-${theme}.png`),
    });
  });
}

interface GpuProbe {
  supported: boolean;
  backend: string;
  enabled: boolean;
  milliseconds: number[];
  disjoint: number;
  discarded: number;
  finish: () => void;
}
interface MapProbe {
  gaps: number[];
  cpu: number[];
  draws: number[];
  triangles: number[];
  meshes: number[];
  instances: number[];
  longTasks: number[];
  boundaries: { at: number; label: string }[];
  stop: () => void;
}
declare global {
  interface Window {
    __mapGpuProbe?: GpuProbe;
    __mapFrameProbe?: MapProbe;
  }
}

async function installGpuProbe(page: Page) {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      id: string,
      options?: unknown,
    ) {
      const value = getContext.call(this, id, options);
      if (id !== "webgl2" || !value) return value;
      const gl = value as WebGL2RenderingContext;
      const extension = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
        TIME_ELAPSED_EXT: number;
        GPU_DISJOINT_EXT: number;
      } | null;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const probe: GpuProbe = {
        supported: !!extension,
        backend: debug
          ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
          : String(gl.getParameter(gl.RENDERER)),
        enabled: false,
        milliseconds: [],
        disjoint: 0,
        discarded: 0,
        finish: () => undefined,
      };
      window.__mapGpuProbe = probe;
      if (!extension) return value;
      const pending: WebGLQuery[] = [];
      let active = false;
      const collect = () => {
        while (
          pending.length &&
          gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)
        ) {
          const query = pending.shift()!;
          if (gl.getParameter(extension.GPU_DISJOINT_EXT)) probe.disjoint++;
          else if (probe.milliseconds.length < 8192)
            probe.milliseconds.push(
              Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6,
            );
          gl.deleteQuery(query);
        }
      };
      probe.finish = () => {
        collect();
        probe.discarded = pending.length;
        for (const query of pending.splice(0)) gl.deleteQuery(query);
      };
      const draw = gl.drawArraysInstanced.bind(gl);
      gl.drawArraysInstanced = (
        ...args: Parameters<WebGL2RenderingContext["drawArraysInstanced"]>
      ) => {
        collect();
        if (probe.enabled && !active && pending.length < 16) {
          const query = gl.createQuery();
          if (query) {
            active = true;
            gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
            queueMicrotask(() => {
              gl.endQuery(extension.TIME_ELAPSED_EXT);
              pending.push(query);
              active = false;
            });
          }
        }
        draw(...args);
      };
      return value;
    } as typeof getContext;
  });
}

async function beginWindow(page: Page) {
  await page
    .locator("#appbar:visible .gameStatus .weak")
    .first()
    .evaluate((date) => {
      const canvas = document.querySelector<MapCanvas>(
        "canvas.territory3DCanvas",
      )!;
      const probe: MapProbe = {
        gaps: [],
        cpu: [],
        draws: [],
        triangles: [],
        meshes: [],
        instances: [],
        longTasks: [],
        boundaries: [],
        stop: () => undefined,
      };
      window.__mapFrameProbe = probe;
      const month = () => date.textContent!.match(/[A-Za-z]+ \d+/)![0];
      let label = month(),
        previous: number | undefined,
        previousDraw = canvas.map3DDiagnostics!().frames,
        raf = 0;
      const observer = new MutationObserver(() => {
        const next = month();
        if (next !== label) {
          probe.boundaries.push({ at: performance.now(), label: next });
          label = next;
        }
      });
      observer.observe(date, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      const longTasks = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (probe.longTasks.length < 8192)
            probe.longTasks.push(entry.duration);
      });
      if (PerformanceObserver.supportedEntryTypes.includes("longtask"))
        longTasks.observe({ type: "longtask" });
      const frame = (at: number) => {
        const diagnostic = canvas.map3DDiagnostics!();
        if (previous !== undefined && probe.gaps.length < 8192) {
          probe.gaps.push(at - previous);
          if (diagnostic.frames !== previousDraw) {
            probe.cpu.push(diagnostic.cpuFrameMs);
            probe.draws.push(diagnostic.drawCalls);
            probe.triangles.push(diagnostic.triangles);
            probe.meshes.push(diagnostic.meshCount);
            probe.instances.push(diagnostic.instanceCount);
          }
        }
        previous = at;
        previousDraw = diagnostic.frames;
        raf = requestAnimationFrame(frame);
      };
      const gpu = window.__mapGpuProbe!;
      gpu.milliseconds = [];
      gpu.disjoint = 0;
      gpu.discarded = 0;
      gpu.enabled = true;
      raf = requestAnimationFrame(frame);
      probe.stop = () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
        longTasks.disconnect();
        gpu.enabled = false;
        gpu.finish();
      };
    });
}

function stats(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    worstMs: sorted.at(-1) ?? 0,
  };
}

test("production 3D frame evidence includes panning and real month rollovers", async ({
  page,
}, info) => {
  test.skip(
    !process.env.E2E_BASE_URL,
    "Set E2E_BASE_URL to a production build to collect timing evidence.",
  );
  test.setTimeout(120000);
  await installGpuProbe(page);
  const { map, canvas, pause } = await startMap(page, "light");
  const runtime = await page.evaluate(() => ({
    mainScript: Array.from(document.scripts).find((script) =>
      /\/static\/js\/main\.[a-f0-9]+\.js/.test(script.src),
    )?.src,
    backend: window.__mapGpuProbe!.backend,
    timerQuerySupported: window.__mapGpuProbe!.supported,
  }));
  expect(
    runtime.mainScript,
    "frame evidence requires a production build served with E2E_BASE_URL",
  ).toBeDefined();
  const topology = (await sample(canvas, true)).scene!;
  expect(
    topology.filter((instance) => instance.id.startsWith("terrain:")).length,
  ).toBeGreaterThan(10);
  const viewport = map.locator(".territoryMapViewport");
  const originalViewport = page.viewportSize()!;
  const desktop = originalViewport.width >= 700;
  const speeds = [
    "slow speed",
    "fast speed",
    ...(desktop ? ["ultra speed"] : []),
  ];
  const windows = [];
  for (const speed of speeds) {
    if (speed === "ultra speed")
      await page.setViewportSize({ ...originalViewport, width: 1440 });
    const box = (await viewport.boundingBox())!;
    await beginWindow(page);
    await page.getByRole("button", { name: speed, exact: true }).click();
    await page.waitForTimeout(800);
    const ordinary = await page.evaluate(
      () => window.__mapFrameProbe!.gaps.length,
    );
    for (const dx of [-box.width * 0.3, box.width * 0.3]) {
      const before = await readTerritoryMapCamera(viewport);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.35);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + dx,
        box.y + box.height * 0.35,
        { steps: 12 },
      );
      await page.mouse.up();
      await expect
        .poll(
          async () =>
            (before.x - (await readTerritoryMapCamera(viewport)).x) *
            Math.sign(dx),
        )
        .toBeGreaterThan(0.5);
    }
    const panned = await page.evaluate(
      () => window.__mapFrameProbe!.gaps.length,
    );
    await expect
      .poll(
        () => page.evaluate(() => window.__mapFrameProbe!.boundaries.length),
        { timeout: 45000 },
      )
      .toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(350);
    await pause.click();
    const result = await page.evaluate(() => {
      const probe = window.__mapFrameProbe!;
      probe.stop();
      const { finish: _finish, ...gpu } = window.__mapGpuProbe!;
      return { ...probe, stop: undefined, gpu };
    });
    expect(result.gaps.length).toBeGreaterThan(30);
    expect(
      result.cpu.length > 0 && result.cpu.every(Number.isFinite),
      "CPU samples must come from the actual renderer",
    ).toBe(true);
    expect(Math.min(...result.draws)).toBeGreaterThan(0);
    expect(Math.min(...result.triangles)).toBeGreaterThan(100);
    if (result.gpu.supported)
      expect(result.gpu.milliseconds.length).toBeGreaterThan(0);
    windows.push({
      speed,
      viewport: page.viewportSize(),
      boundaries: result.boundaries,
      ordinary: stats(result.gaps.slice(0, ordinary)),
      pan: stats(result.gaps.slice(ordinary, panned)),
      callbackGaps: stats(result.gaps),
      cpuFrame: stats(result.cpu),
      gpuDraws: result.gpu.supported ? stats(result.gpu.milliseconds) : null,
      gpuDisjointSamples: result.gpu.disjoint,
      gpuDiscardedQueries: result.gpu.discarded,
      maxDrawCalls: Math.max(...result.draws),
      maxTriangles: Math.max(...result.triangles),
      maxMeshes: Math.max(...result.meshes),
      maxInstances: Math.max(...result.instances),
      longTasks: stats(result.longTasks),
      raw: result,
    });
  }
  const report = {
    project: info.project.name,
    browser: page.context().browser()!.version(),
    viewport: originalViewport,
    targetHz: desktop ? 120 : 60,
    frameBudgetMs: 1000 / (desktop ? 120 : 60),
    runtime,
    windows,
    limits:
      "CPU frame timing includes renderer scene preparation and submission, and excludes asynchronous GPU execution. Timer queries, when available and not disjoint, measure the submitted map draw interval. RAF gaps measure callback scheduling, not physical presentation. Viewport emulation is not real phone testing. Existing targets and bundle ceilings are unchanged; timing samples are lab evidence, not machine-dependent CI gates.",
  };
  const reportPath = info.outputPath("map-3d-performance.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  await info.attach("map-3d-performance.json", {
    path: reportPath,
    contentType: "application/json",
  });
});
