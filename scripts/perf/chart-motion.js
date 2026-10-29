// Opt-in paired production-browser benchmark for the daily chart motion budget.
// Build the original source and candidate into separate directories, then run:
// MOTION_BASE=/absolute/baseline MOTION_CANDIDATE=/absolute/candidate \
//   node scripts/perf/chart-motion.js
// Repeat with --untraced-only for secondary renderer-main-thread CPU evidence.
// Both builds use the same origin, seeded scenario, isolated context, browser,
// viewport, warm-up, and equal real-time window; pair order alternates.
// Output, including compressed traces, stays under .tmp/chart-motion/qa.
// The primary gate includes synchronous chart drawing AND rendering, raster,
// and compositor work across the full window, including between simulation ticks.
// Trace intervals are merged per thread before summing, excluding unrelated PIDs.
// A paired median above 1.10 fails. Keep raw samples and backend metadata:
// these are lab measurements, not guarantees for every machine or physical GPU.

const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const zlib = require("node:zlib");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { acquireLease, reservePort } = require("../dev/coordination");
const { browserLaunchOptions } = require("../ci/browser-launch");
const root = path.resolve(__dirname, "../..");
const out = path.resolve(
  process.env.MOTION_OUTPUT ||
    path.join(
      root,
      ".tmp/chart-motion/qa",
      new Date().toISOString().replace(/[:.]/g, "-"),
    ),
);
const candidate = path.resolve(
  process.env.MOTION_CANDIDATE || path.join(root, ".tmp/check-builds/web"),
);
const dirs = {
  base: path.resolve(
    process.env.MOTION_BASE || path.join(root, ".tmp/chart-motion/base"),
  ),
  candidate,
};
const durationMs = Number(process.env.MOTION_DURATION_MS || "8000");
const rounds = Number(process.env.MOTION_ROUNDS || "3");
const smoke = process.argv.includes("--smoke");
const untracedOnly = process.argv.includes("--untraced-only");
const channel = process.env.MOTION_CHANNEL || "chromium";
const keepAwakeRequested = process.env.MOTION_KEEP_AWAKE === "1";
if (process.argv.includes("--help")) {
  report(
    "Paired production chart-render benchmark. Set MOTION_BASE, MOTION_CANDIDATE, optional MOTION_OUTPUT, MOTION_ROUNDS (3), MOTION_DURATION_MS (8000), MOTION_CASE (focused case substring), MOTION_CHANNEL (chromium or shell), MOTION_KEEP_AWAKE=1 (bounded macOS display assertion after acquiring the slot). Default traces render/raster/compositor work; --untraced-only measures secondary renderer CPU without tracing. --smoke validates only the baseline workload.",
  );
  process.exit(0);
}
if (!Number.isInteger(rounds) || rounds < 1)
  throw new Error("MOTION_ROUNDS must be a positive integer");
if (!Number.isFinite(durationMs) || durationMs < 2000)
  throw new Error("MOTION_DURATION_MS must be at least 2000");
if (
  process.argv
    .slice(2)
    .some(
      (arg) => !["--smoke", "--untraced-only", "--trace-only"].includes(arg),
    )
)
  throw new Error("Unknown benchmark option");
const TRACE_CATEGORIES =
  "devtools.timeline,disabled-by-default-devtools.timeline,blink,blink.user_timing,cc,viz,gpu";
const caseFilter = process.env.MOTION_CASE;
const allCases = [
  { name: "desktop-1920-1x", width: 1920, height: 1080, speed: "slow speed" },
  {
    name: "desktop-1920-dpr2-1x",
    width: 1920,
    height: 1080,
    speed: "slow speed",
    dpr: 2,
  },
  {
    name: "desktop-1920-hydro-dpr2-1x",
    width: 1920,
    height: 1080,
    speed: "slow speed",
    scenario: 108,
    dpr: 2,
  },
  {
    name: "mobile-390-1x",
    width: 390,
    height: 844,
    speed: "slow speed",
    mobile: true,
  },
  {
    name: "desktop-1920-hydro-1x",
    width: 1920,
    height: 1080,
    speed: "slow speed",
    scenario: 108,
  },
  {
    name: "mobile-390-hydro-1x",
    width: 390,
    height: 844,
    speed: "slow speed",
    scenario: 108,
    mobile: true,
  },
  { name: "desktop-1920-3x", width: 1920, height: 1080, speed: "normal speed" },
  {
    name: "mobile-390-3x",
    width: 390,
    height: 844,
    speed: "normal speed",
    mobile: true,
  },
  { name: "desktop-1920-12x", width: 1920, height: 1080, speed: "fast speed" },
];
const priority = {
  "desktop-1920-hydro-dpr2-1x": 0,
  "desktop-1920-dpr2-1x": 1,
  "mobile-390-hydro-1x": 2,
};
const cases = allCases
  .filter((c) => !caseFilter || c.name.includes(caseFilter))
  .sort((a, b) => (priority[a.name] ?? 10) - (priority[b.name] ?? 10));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};
function report(message) {
  process.stdout.write(message + "\n");
}
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function intervalsMs(ranges) {
  ranges.sort((a, b) => a[0] - b[0]);
  let sum = 0,
    lastStart,
    lastEnd;
  for (const [start, end] of ranges) {
    if (lastEnd === undefined) {
      lastStart = start;
      lastEnd = end;
    } else if (start <= lastEnd) lastEnd = Math.max(lastEnd, end);
    else {
      sum += lastEnd - lastStart;
      lastStart = start;
      lastEnd = end;
    }
  }
  return (sum + (lastEnd === undefined ? 0 : lastEnd - lastStart)) / 1000;
}
async function digestBuild(directory) {
  const hash = createHash("sha256");
  let files = 0,
    bytes = 0;
  async function visit(relative = "") {
    const entries = await fs.readdir(path.join(directory, relative), {
      withFileTypes: true,
    });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else {
        if (!entry.isFile())
          throw new Error(`Unsupported build artifact: ${name}`);
        const content = await fs.readFile(path.join(directory, name));
        hash.update(
          name.split(path.sep).join("/") + "\0" + content.length + "\0",
        );
        hash.update(createHash("sha256").update(content).digest());
        files++;
        bytes += content.length;
      }
    }
  }
  await visit();
  return { sha256: hash.digest("hex"), files, bytes };
}

function summarizeTrace(events, measured) {
  const start = events.find(
    (e) =>
      e.name === "chart-motion-window-start" && e.cat?.includes("user_timing"),
  );
  const end = events.find(
    (e) =>
      e.name === "chart-motion-window-end" && e.cat?.includes("user_timing"),
  );
  if (!start || !end) throw new Error("Missing exact trace window markers");
  const threadNames = new Map(
    events
      .filter((e) => e.ph === "M" && e.name === "thread_name")
      .map((e) => [`${e.pid}:${e.tid}`, e.args.name]),
  );
  const allowedPids = new Set([
    start.pid,
    ...events
      .filter(
        (e) =>
          e.ph === "M" &&
          e.name === "thread_name" &&
          /CrGpuMain|VizCompositorThread/.test(e.args.name),
      )
      .map((e) => e.pid),
  ]);
  const mainNames = new Set([
    "UpdateLayoutTree",
    "Layout",
    "PrePaint",
    "Paint",
    "Layerize",
    "UpdateLayerTree",
    "CompositeLayers",
    "ComputeIntersections",
    "Commit",
    "UpdateLayer",
    "LayerTreeHost::DoUpdateLayers",
    "PaintArtifactCompositor::Update",
  ]);
  const ranges = new Map(),
    mainRanges = new Map(),
    rasterRanges = new Map(),
    compositorRanges = new Map(),
    offMainRanges = new Map();
  const names = {};
  function add(map, key, a, b) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push([a, b]);
  }
  for (const e of events) {
    if (
      e.ph !== "X" ||
      !e.dur ||
      !allowedPids.has(e.pid) ||
      e.ts >= end.ts ||
      e.ts + e.dur <= start.ts
    )
      continue;
    const thread = `${e.pid}:${e.tid}`;
    const threadName = threadNames.get(thread) || "";
    // Canvas finalization/resource publication happens after JavaScript drawing returns.
    // Include it rather than hiding that work outside the drawing-block probe.
    const canvasLifecycle =
      /^(?:HTMLCanvas|OffscreenCanvas|BaseRenderingContext2D|Canvas|PaintController|PaintArtifactCompositor|SharedImage).*::/.test(
        e.name,
      );
    const renderLifecycle =
      /^LocalFrameView::(?:RunPaint|RunPrePaint|RunCompositing|Update.*Lifecycle)/.test(
        e.name,
      );
    const rendererGpuCommand =
      e.pid === start.pid &&
      e.tid === start.tid &&
      e.cat?.split(",").includes("gpu");
    const main =
      e.pid === start.pid &&
      e.tid === start.tid &&
      (mainNames.has(e.name) ||
        canvasLifecycle ||
        renderLifecycle ||
        rendererGpuCommand);
    const raster =
      /RasterTask|RasterBufferProvider::Playback|RasterizerTaskImpl::RunOnWorkerThread/.test(
        e.name,
      );
    const compositor =
      !main &&
      !raster &&
      /Compositor|CrGpuMain|Viz/.test(threadName) &&
      e.cat?.split(",").some((c) => c === "cc" || c === "viz" || c === "gpu") &&
      (canvasLifecycle ||
        /Draw|Animate|Animation|Commit|Activate|PrepareToDraw|SwapBuffers|Raster|Flush|Present|Produce|Resource|Submit|Copy|Transfer/.test(
          e.name,
        ));
    if (!main && !raster && !compositor) continue;
    const a = Math.max(e.ts, start.ts),
      b = Math.min(e.ts + e.dur, end.ts);
    add(ranges, thread, a, b);
    if (main) add(mainRanges, thread, a, b);
    if (raster) add(rasterRanges, thread, a, b);
    if (compositor) add(compositorRanges, thread, a, b);
    if (threadName !== "CrRendererMain") add(offMainRanges, thread, a, b);
    names[e.name] ||= { count: 0, inclusiveMs: 0, threads: [] };
    names[e.name].count++;
    names[e.name].inclusiveMs += (b - a) / 1000;
    if (!names[e.name].threads.includes(threadName))
      names[e.name].threads.push(threadName);
  }
  function sum(map) {
    return [...map.values()].reduce((s, r) => s + intervalsMs(r), 0);
  }
  const combined = new Map(
    [...ranges].map(([key, value]) => [key, [...value]]),
  );
  const mainThread = `${start.pid}:${start.tid}`;
  for (const [a, b] of measured.drawBlockRanges) {
    const from = Math.max(
      start.ts,
      start.ts + (a - measured.windowStart) * 1000,
    );
    const to = Math.min(end.ts, start.ts + (b - measured.windowStart) * 1000);
    if (to > from) add(combined, mainThread, from, to);
  }
  const chartAndPipelineMs = sum(combined);
  const overlapMs = Math.max(
    0,
    measured.drawBlockMs + sum(ranges) - chartAndPipelineMs,
  );
  return {
    chartAndPipelineMs,
    drawPipelineOverlapMs: overlapMs,
    currentRendererPid: start.pid,
    allowedPids: [...allowedPids],
    windowMs: (end.ts - start.ts) / 1000,
    renderThreadMs: sum(ranges),
    mainRenderMs: sum(mainRanges),
    rasterMs: sum(rasterRanges),
    compositorMs: sum(compositorRanges),
    offMainRenderMs: sum(offMainRanges),
    threads: [...ranges.entries()].map(([key, rs]) => ({
      name: threadNames.get(key) || key,
      ms: intervalsMs(rs),
    })),
    names,
  };
}
async function main() {
  const abort = new AbortController();
  let lease, server, browser, portLease, keepAwake;
  const interrupt = () => {
    abort.abort();
    void browser?.close().catch(() => {});
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    lease = await acquireLease("heavy", {
      signal: abort.signal,
      onWait: (owner) =>
        report(`Waiting for validation in ${owner.cwd} (PID ${owner.pid})`),
    });
    abort.signal.throwIfAborted();
    await fs.mkdir(out, { recursive: true });
    require("../dev/preflight").checkDependencies(root);
    require("../check-assets").checkAssets(root);
    portLease = await reservePort(undefined, { signal: abort.signal });
    const cache = new Map();
    server = http.createServer(async (req, res) => {
      try {
        const variant =
          req.headers["x-chart-variant"] === "candidate" ? "candidate" : "base";
        const url = new URL(req.url, "http://localhost");
        const file = path.resolve(
          dirs[variant],
          "." + decodeURIComponent(url.pathname),
        );
        if (
          file !== dirs[variant] &&
          !file.startsWith(dirs[variant] + path.sep)
        ) {
          res.writeHead(403).end();
          return;
        }
        const target =
          file === dirs[variant] ? path.join(file, "index.html") : file;
        if (!cache.has(target)) cache.set(target, await fs.readFile(target));
        res
          .writeHead(200, {
            "Content-Type":
              types[path.extname(target)] || "application/octet-stream",
            "Cache-Control": "no-store",
          })
          .end(cache.get(target));
      } catch (e) {
        res.writeHead(e.code === "ENOENT" ? 404 : 500).end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(portLease.port, "127.0.0.1", resolve);
    });
    const url = `http://127.0.0.1:${portLease.port}`;
    report(
      `Reserved benchmark origin ${url}; baseline=${dirs.base}; candidate=${dirs.candidate}`,
    );
    if (keepAwakeRequested && process.platform === "darwin") {
      keepAwake = spawn(
        "/usr/bin/caffeinate",
        ["-d", "-i", "-u", "-t", "900"],
        { stdio: "ignore" },
      );
      await new Promise((resolve, reject) => {
        keepAwake.once("spawn", resolve);
        keepAwake.once("error", reject);
      });
      abort.signal.throwIfAborted();
    }
    browser = await chromium.launch({
      headless: true,
      ...browserLaunchOptions(),
      ...(channel === "shell" ? {} : { channel }),
    });
    const results = [];
    const artifactsBefore = Object.fromEntries(
      await Promise.all(
        Object.entries(dirs).map(async ([variant, dir]) => [
          variant,
          await digestBuild(dir),
        ]),
      ),
    );
    const buildIds = Object.fromEntries(
      await Promise.all(
        Object.entries(dirs).map(async ([variant, dir]) => {
          const manifest = JSON.parse(
            await fs.readFile(path.join(dir, "asset-manifest.json"), "utf8"),
          );
          return [
            variant,
            {
              main: manifest.files["main.js"],
              css: manifest.files["main.css"],
            },
          ];
        }),
      ),
    );
    report("BUILDS " + JSON.stringify(buildIds));
    const browserCdp = await browser.newBrowserCDPSession();
    const gpuInfo = (await browserCdp.send("SystemInfo.getInfo")).gpu;
    const gpu = {
      renderer: gpuInfo.auxAttributes?.glRenderer,
      displayType: gpuInfo.auxAttributes?.displayType,
      features: gpuInfo.featureStatus,
    };
    report("GPU " + JSON.stringify(gpu));
    const processTimes = async () =>
      (await browserCdp.send("SystemInfo.getProcessInfo")).processInfo;
    const run = async (c, variant, round, trace) => {
      abort.signal.throwIfAborted();
      const context = await browser.newContext({
        viewport: { width: c.width, height: c.height },
        hasTouch: !!c.mobile,
        isMobile: !!c.mobile,
        deviceScaleFactor: c.dpr || 1,
        colorScheme: "light",
        reducedMotion: "no-preference",
        extraHTTPHeaders: { "X-Chart-Variant": variant },
      });
      try {
        await context.addInitScript(() => {
          localStorage.clear();
          localStorage.setItem("audioEnabled", "false");
          localStorage.setItem("theme", "light");
          localStorage.setItem("electrify-cloud-save-prompt-seen", "true");
          Math.random = () => 12345 / 2 ** 32;
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(url + "/?scenario=" + (c.scenario || 103));
        await page
          .getByRole("button", { name: "Start game", exact: true })
          .click();
        await page.locator("#chartSupplyDemand:visible .uplot").waitFor();
        await page.evaluate(() => document.fonts.ready);
        const appbar = page.locator("#appbar:visible").first();
        const speed = appbar.getByRole("button", {
          name: c.speed,
          exact: true,
        });
        // Use actual action events, excluding Playwright's actionability/return overhead.
        await speed.evaluate((button) => {
          button.addEventListener(
            "click",
            () => {
              window.__chartPlayingStarted = performance.now();
            },
            { once: true, capture: true },
          );
        });
        await appbar
          .getByRole("button", { name: "pause", exact: true })
          .evaluate((button) => {
            button.addEventListener(
              "click",
              () => {
                window.__chartPlayingEnded = performance.now();
              },
              { once: true, capture: true },
            );
          });
        await speed.click();
        await page.mouse.move(0, 0);
        // Prime chart paints, pipelines, and ordinary-tick work before the timing window.
        await page.waitForTimeout(smoke ? 500 : 2000);
        await page.evaluate(() => {
          const target = document.querySelector(
            "#chartSupplyDemand .u-wrap > canvas",
          );
          if (!target) throw new Error("Missing uPlot canvas");
          const surfaces = new Set([
            target,
            ...document.querySelectorAll(
              "#chartSupplyDemand [data-production-motion] canvas",
            ),
          ]);
          if (document.querySelectorAll(".uplot").length !== 1)
            throw new Error(
              "Chart draw microtask probe requires exactly one mounted uPlot",
            );
          // The generated uPlot canvas is outside React's host children. Find its owning
          // component's ref read-only, then instrument only uPlot's public method.
          let owner = target;
          let fiberKey;
          while (owner && !fiberKey) {
            fiberKey = Object.keys(owner).find((key) =>
              key.startsWith("__reactFiber$"),
            );
            if (!fiberKey) owner = owner.parentElement;
          }
          const plots = new Set();
          let fiber = owner?.[fiberKey];
          while (fiber) {
            let hook = fiber.memoizedState;
            while (
              hook &&
              typeof hook === "object" &&
              "memoizedState" in hook
            ) {
              const current = hook.memoizedState?.current;
              if (
                current?.ctx?.canvas === target &&
                typeof current.valToPos === "function"
              )
                plots.add(current);
              hook = hook.next;
            }
            fiber = fiber.return;
          }
          if (plots.size !== 1)
            throw new Error(
              `Need one target uPlot ref; found ${plots.size}. Review the React hook lookup before measuring.`,
            );
          const plot = [...plots][0];
          const probe = {
            valToPosCalls: 0,
            targetClears: 0,
            motionSurfaceClears: 0,
            fullTargetClears: 0,
            chartClears: 0,
            drawBlocks: 0,
            drawBlockMs: 0,
            drawBlockRanges: [],
            gaps: [],
            active: false,
            previous: undefined,
          };
          window.__chartMotionProbe = probe;
          let blockOpen = false;
          const openDrawBlock = () => {
            if (!probe.active || blockOpen) return;
            blockOpen = true;
            const blockStart = performance.now();
            queueMicrotask(() => {
              const blockEnd = performance.now();
              probe.drawBlocks++;
              probe.drawBlockMs += blockEnd - blockStart;
              probe.drawBlockRanges.push([blockStart, blockEnd]);
              blockOpen = false;
            });
          };
          const valToPos = plot.valToPos;
          plot.valToPos = function (...args) {
            if (probe.active) probe.valToPosCalls++;
            openDrawBlock();
            return valToPos.apply(this, args);
          };
          const clear = CanvasRenderingContext2D.prototype.clearRect;
          CanvasRenderingContext2D.prototype.clearRect = function (...args) {
            if (probe.active) {
              if (this.canvas === target) {
                probe.targetClears++;
                if (args[2] >= target.width * 0.95) probe.fullTargetClears++;
              }
              if (surfaces.has(this.canvas)) {
                if (this.canvas !== target) probe.motionSurfaceClears++;
                openDrawBlock();
              }
              if (this.canvas.closest("#chartSupplyDemand"))
                probe.chartClears++;
            }
            return clear.apply(this, args);
          };
          const copy = CanvasRenderingContext2D.prototype.drawImage;
          CanvasRenderingContext2D.prototype.drawImage = function (...args) {
            if (surfaces.has(this.canvas) || surfaces.has(args[0]))
              openDrawBlock();
            return copy.apply(this, args);
          };
          const loop = (at) => {
            if (probe.active && probe.previous !== undefined)
              probe.gaps.push(at - probe.previous);
            probe.previous = at;
            probe.raf = requestAnimationFrame(loop);
          };
          probe.raf = requestAnimationFrame(loop);
        });
        const cdp = await context.newCDPSession(page);
        await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
        let traceDone;
        if (trace) {
          traceDone = new Promise((resolve) =>
            cdp.once("Tracing.tracingComplete", resolve),
          );
          await cdp.send("Tracing.start", {
            categories: TRACE_CATEGORIES,
            transferMode: "ReturnAsStream",
          });
        }
        const before = (await cdp.send("Performance.getMetrics")).metrics;
        const processesBefore = await processTimes();
        const measured = await page.evaluate(
          async (ms) => {
            const probe = window.__chartMotionProbe;
            probe.active = true;
            performance.mark("chart-motion-window-start");
            probe.windowStart = performance
              .getEntriesByName("chart-motion-window-start")
              .at(-1).startTime;
            const start = performance.now();
            await new Promise((resolve) => setTimeout(resolve, ms));
            const elapsed = performance.now() - start;
            performance.mark("chart-motion-window-end");
            probe.active = false;
            cancelAnimationFrame(probe.raf);
            return { ...probe, elapsed, raf: undefined };
          },
          smoke ? 2000 : durationMs,
        );
        const after = (await cdp.send("Performance.getMetrics")).metrics;
        const processesAfter = await processTimes();
        await appbar
          .getByRole("button", { name: "pause", exact: true })
          .click();
        const playingMs = await page.evaluate(() => {
          if (
            !Number.isFinite(window.__chartPlayingStarted) ||
            !Number.isFinite(window.__chartPlayingEnded)
          )
            throw new Error("Missing playing action timestamps");
          return window.__chartPlayingEnded - window.__chartPlayingStarted;
        });
        const processCpuMs = {};
        for (const process of processesAfter) {
          const previous = processesBefore.find((p) => p.id === process.id);
          if (previous)
            processCpuMs[process.type] =
              (processCpuMs[process.type] || 0) +
              (process.cpuTime - previous.cpuTime) * 1000;
        }
        processCpuMs.rendererGpuMs =
          (processCpuMs.renderer || 0) + (processCpuMs.GPU || 0);
        const metrics = {};
        for (const { name, value } of after) {
          const prior = before.find((m) => m.name === name)?.value;
          if (prior !== undefined) metrics[name] = value - prior;
        }
        let tracing;
        if (trace) {
          await cdp.send("Tracing.end");
          const { stream } = await traceDone;
          let json = "";
          while (true) {
            const part = await cdp.send("IO.read", { handle: stream });
            json += part.data;
            if (part.eof) break;
          }
          await cdp.send("IO.close", { handle: stream });
          const traceData = JSON.parse(json);
          tracing = summarizeTrace(traceData.traceEvents, measured);
          if (!(tracing.renderThreadMs > 0 && tracing.compositorMs > 0))
            throw new Error(
              "Trace is missing rendering/compositing attribution; review Chromium event names",
            );
          await fs.writeFile(
            path.join(out, `${c.name}-${variant}-${round}.trace.json.gz`),
            zlib.gzipSync(json),
          );
        }
        await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
        await page.waitForTimeout(100);
        const saved = await page.evaluate(
          () =>
            new Promise((resolve, reject) => {
              const request = indexedDB.open("electrify-saves");
              request.onerror = () => reject(request.error);
              request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction("payloads", "readonly");
                const q = tx.objectStore("payloads").getAll();
                q.onsuccess = () => {
                  db.close();
                  resolve(
                    q.result.map((p) => ({
                      minute: p.save?.game?.date?.minute,
                      seed: p.save?.game?.seed,
                      scenario: p.save?.game?.scenarioId,
                    })),
                  );
                };
              };
            }),
        );
        if (errors.length) throw new Error(errors.join("\n"));
        if (
          saved.length !== 1 ||
          saved[0].seed !== 12345 ||
          saved[0].scenario !== (c.scenario || 103)
        )
          throw new Error("Unmatched seeded run: " + JSON.stringify(saved));
        // Fresh runs start at minute zero. Allow two ticks for action/measurement boundaries,
        // but reject a stalled clock rather than mistaking fewer simulation updates for savings.
        const stepMs = {
          "slow speed": 200,
          "normal speed": 60,
          "fast speed": 1000 / 60,
        }[c.speed];
        const progress = {
          playingMs,
          minutesAdvanced: saved[0].minute,
          expectedMinutes: (playingMs / stepMs) * 15,
          toleranceMinutes: 30,
        };
        progress.valid =
          Math.abs(progress.minutesAdvanced - progress.expectedMinutes) <=
          progress.toleranceMinutes;
        const gaps = [...measured.gaps].sort((a, b) => a - b);
        if (tracing) {
          tracing.presentationCpuMs =
            metrics.TaskDuration * 1000 + tracing.offMainRenderMs;
        }
        const result = {
          case: c.name,
          variant,
          round,
          trace,
          processCpuMs,
          measured: {
            elapsed: measured.elapsed,
            valToPosCalls: measured.valToPosCalls,
            targetClears: measured.targetClears,
            motionSurfaceClears: measured.motionSurfaceClears,
            fullTargetClears: measured.fullTargetClears,
            chartClears: measured.chartClears,
            drawBlocks: measured.drawBlocks,
            drawBlockMs: measured.drawBlockMs,
            drawBlockRanges: measured.drawBlockRanges,
            windowStart: measured.windowStart,
            frames: gaps.length,
            cadenceHz: (gaps.length * 1000) / measured.elapsed,
            cadenceValid:
              (gaps.length * 1000) / measured.elapsed >= 50 &&
              gaps[Math.floor(gaps.length * 0.5)] <= 20,
            p50Gap: gaps[Math.floor(gaps.length * 0.5)],
            p95Gap: gaps[Math.floor(gaps.length * 0.95)],
            worstGap: gaps.at(-1),
          },
          metrics,
          saved,
          progress,
          tracing,
        };
        report(
          JSON.stringify({
            case: c.name,
            variant,
            round,
            trace,
            measurement: { ...result.measured, drawBlockRanges: undefined },
            processCpuMs,
            taskMs: metrics.TaskDuration * 1000,
            presentationCpuMs: tracing?.presentationCpuMs,
            renderMs: tracing?.renderThreadMs,
            saved,
            progress,
          }),
        );
        results.push(result);
        await fs.writeFile(
          path.join(out, "paired-render-results.json"),
          JSON.stringify(
            {
              metadata: {
                browser: browser.version(),
                gpu,
                keepAwakeRequested,
                keepAwakeEnabled: Boolean(keepAwake),
                traceCategories: TRACE_CATEGORIES,
                drawProbe:
                  "Target canvas clear/copy and public valToPos to microtask; unique plot ref matched through read-only React hook lookup",
                buildIds,
                artifactsBefore,
                cases,
                node: process.version,
                base: dirs.base,
                candidate: dirs.candidate,
                durationMs,
                rounds,
                startedAt: new Date().toISOString(),
                notes:
                  "Headless same-machine lab evidence; no physical GPU or 120 Hz guarantee. Exact trace windows; sums merge overlapping render-event intervals per thread. Untraced TaskDuration rounds measure total renderer-main-thread work. Browser contexts are isolated but run serially in one browser.",
              },
              results,
            },
            null,
            2,
          ),
        );
        if (!progress.valid)
          throw new Error(
            `Invalid ${c.name}/${variant} simulation progress: ${JSON.stringify(progress)}; do not use fewer updates as render savings.`,
          );
        if (!result.measured.cadenceValid)
          throw new Error(
            `Invalid ${c.name}/${variant} timing window: ${result.measured.cadenceHz.toFixed(1)} Hz; need >=50Hz callbacks. Investigate host display/power throttling or a performance regression; do not use this sample to claim the budget passed.`,
          );
      } finally {
        await context.close();
      }
    };
    if (!cases.length)
      throw new Error("MOTION_CASE matched no benchmark workload");
    for (const c of cases) {
      if (smoke) {
        await run(c, "base", 0, true);
        break;
      }
      for (let i = 0; i < rounds; i++) {
        for (const variant of i % 2 === 0
          ? ["base", "candidate"]
          : ["candidate", "base"])
          await run(c, variant, i, !untracedOnly);
      }
    }
    const artifactsAfter = Object.fromEntries(
      await Promise.all(
        Object.entries(dirs).map(async ([variant, dir]) => [
          variant,
          await digestBuild(dir),
        ]),
      ),
    );
    const artifactsStable =
      JSON.stringify(artifactsBefore) === JSON.stringify(artifactsAfter);
    await fs.writeFile(
      path.join(out, "artifact-verification.json"),
      JSON.stringify(
        {
          before: artifactsBefore,
          after: artifactsAfter,
          stable: artifactsStable,
        },
        null,
        2,
      ),
    );
    if (!artifactsStable)
      throw new Error(
        "Production build artifacts changed during measurement; discard mixed-build evidence",
      );
    const summary = [];
    for (const c of cases) {
      for (const trace of [false, true]) {
        const samples = results.filter(
          (r) => r.case === c.name && r.trace === trace,
        );
        if (!samples.length) continue;
        const bs = samples.filter((r) => r.variant === "base"),
          cs = samples.filter((r) => r.variant === "candidate");
        if (!bs.length || !cs.length) continue;
        const row = {
          case: c.name,
          trace,
          rounds: bs.length,
          progress: bs.map((b) => {
            const c = cs.find((c) => c.round === b.round);
            const differenceMinutes =
              c.progress.minutesAdvanced -
              (b.progress.minutesAdvanced * c.progress.playingMs) /
                b.progress.playingMs;
            return {
              round: b.round,
              differenceMinutes,
              toleranceMinutes: 30,
              valid: Math.abs(differenceMinutes) <= 30,
            };
          }),
          ratios: {},
        };
        const compare = (read) => {
          const before = bs.map(read);
          const after = cs.map(read);
          const pairedRatios = bs.map(
            (b) => read(cs.find((c) => c.round === b.round)) / read(b),
          );
          return {
            baseMs: median(before),
            candidateMs: median(after),
            ratio: median(after) / median(before),
            pairedMedianRatio: median(pairedRatios),
            pairedRatios,
          };
        };
        for (const metric of [
          "TaskDuration",
          "ScriptDuration",
          "LayoutDuration",
          "RecalcStyleDuration",
        ])
          row.ratios[metric] = compare((r) => r.metrics[metric] * 1000);
        if (trace)
          for (const metric of [
            "renderThreadMs",
            "mainRenderMs",
            "rasterMs",
            "compositorMs",
            "offMainRenderMs",
            "presentationCpuMs",
            "chartAndPipelineMs",
          ])
            row.ratios[metric] = compare((r) => r.tracing[metric]);
        summary.push(row);
      }
    }
    await fs.writeFile(
      path.join(out, "paired-render-summary.json"),
      JSON.stringify(summary, null, 2),
    );
    report("SUMMARY " + JSON.stringify(summary));
    if (!smoke) {
      const metric = untracedOnly ? "TaskDuration" : "chartAndPipelineMs";
      const invalidProgress = summary.filter((row) =>
        row.progress.some((pair) => !pair.valid),
      );
      if (invalidProgress.length)
        throw new Error(
          "Unmatched paired simulation progress: " +
            JSON.stringify(
              invalidProgress.map((row) => ({
                case: row.case,
                progress: row.progress,
              })),
            ),
        );
      const failures = summary.filter(
        (row) => row.ratios[metric].pairedMedianRatio > 1.1,
      );
      if (failures.length) {
        console.error(
          "10% budget exceeded: " +
            failures
              .map(
                (row) =>
                  row.case +
                  " " +
                  ((row.ratios[metric].pairedMedianRatio - 1) * 100).toFixed(
                    2,
                  ) +
                  "%",
              )
              .join(", "),
        );
        process.exitCode = 1;
      }
    }
    report("Evidence directory: " + out);
  } finally {
    await browser?.close();
    if (server?.listening)
      await new Promise((resolve) => server.close(resolve));
    if (
      keepAwake?.pid &&
      keepAwake.exitCode === null &&
      keepAwake.signalCode === null
    ) {
      await new Promise((resolve) => {
        keepAwake.once("exit", resolve);
        keepAwake.kill("SIGTERM");
      });
    }
    portLease?.release();
    lease?.release();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
