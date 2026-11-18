# Territory map rendering and performance evidence

The map uses cached solid meshes and a WebGL2 renderer. Terrain, upright buildings,
conductors and projected shadows share the existing map camera. HTML targets retain
keyboard, touch, ownership and selection behavior. The detailed SVG renderer is
mounted only when WebGL2 is unavailable or its context is lost; the healthy renderer
keeps the SVG status and ownership overlays.

`territory-3d/Types.ts` owns the model contract. Models use tile-width units with
positive Y pointing upward. Terrain models have four clearing buckets and six-bit
river port masks; structures have one cached model per `StructureKind`. Wire meshes
are grouped by fog and retained while topology and terminals stay the same. The
renderer retains all currently needed meshes plus at most 64 unused meshes. Facility
phases retain the current scene plus at most 256 culled identities. Neither cache
uses simulation ticks or tile identities as an unbounded model key.

The renderer owns one animation clock. Idle and reduced-motion scenes draw when
a visual input changes. Camera and simulation updates that arrive before a draw
share one scene preparation pass. Hidden documents and invisible surfaces skip GPU
batch preparation and drawing. Wholly culled motion stops scheduling frames.
A paused simulation leaves decorative production motion at 25%. Operation pause,
idle, construction, reduced motion and visibility suspension preserve each
facility's phase. Lighting uses the simulated minute and the existing
sunrise/sunset calculation. Wall-clock time never advances sunlight.

## Inspecting actual geometry

`canvas.map3DDiagnostics()` samples current frame counters, CPU scene preparation and
submission duration, phase, playback rate, visibility and actual lighting inputs.
`frameMs` remains a compatibility alias of `cpuFrameMs`. These durations exclude asynchronous GPU
execution, React work that builds scene inputs, browser compositing and physical
presentation.

`canvas.map3DDiagnostics(true)` additionally scans the actual submitted draw passes.
It reports each submitted instance's model key, triangle count, posed world-space
bounds and the fog values packed for the GPU. This scan is intentionally omitted
from ordinary samples. Grouped conductors include endpoint identities, actual
terminal positions and the lowest sampled centerline height from their geometry
builder. Diagnostics are copied on demand; no per-frame DOM attributes or React
updates carry the scene.

`e2e/acquisitions.spec.ts` compares these submitted meshes and conductors with the
discovered map, preserving the existing culling, ownership, adjacency, submerged
wire, foreign-facility and facility-state checks. Its WAAPI motion journey explicitly
forces the SVG fallback. `e2e/map-3d-performance.spec.ts` separately exercises real
GPU phases, all available speed controls, operation pause, reduced motion, hidden
documents, foreign operation and frozen/advancing simulated lighting in both themes.
Optional review captures wait for real near-noon sunlight and attach the saved
simulation date alongside each picture.

## Production measurement

Serve a fresh production web build with the normal repository tooling, then run:

```sh
E2E_BASE_URL=http://127.0.0.1:49889 npm run test:e2e -- \
  e2e/map-3d-performance.spec.ts \
  --project=desktop-chromium --project=mobile-390px --project=mobile-360px
```

Use the port printed by the task-owned production server. The timing journey rejects
a development entrypoint. It covers the 1280 px desktop and 390/360 px phone layouts,
including actual camera drags and at least one real month rollover at each available
1×, 12× and desktop 24× speed. The 24× control uses the existing 1300 px breakpoint;
that desktop window resizes to 1440 px and records its own viewport separately from
the 1280 px 1×/12× windows. Its `map-3d-performance.json` attachment retains raw
samples, browser/build/backend identity, callback gaps, CPU frame duration, long
tasks, draw/triangle counts and peak mesh/instance counts. Each recorded CPU frame
duration represents a new draw. Samples and pending GPU queries are bounded.

Where the browser exposes `EXT_disjoint_timer_query_webgl2`, test-only instrumentation
times the map's actual draw interval with GPU queries. Unavailable timers are reported
as unsupported; disjoint query results are counted and discarded. A missing GPU timer
is never replaced with CPU submission time. The measurement records ordinary and
panning callback windows separately and retains the rendered month boundaries.

The existing goals remain 120 Hz / 8.33 ms for desktop and 60 Hz / 16.67 ms for
phones, with roughly half the frame available for presentation and tick work. These
are lab reports, following `e2e/frame-budget.spec.ts`. The production CI matrix
runs the functional `e2e/map-3d.spec.ts` suite. Callback cadence cannot prove physical presentation, a 60 Hz
headless callback stream cannot demonstrate 120 Hz, and viewport emulation cannot
certify a phone GPU. Report those limits together with results. The Valley map,
build rail and inspection styles increase the main CSS gzip baseline from 30,800
to 34,118 bytes. The existing 10% tolerance sets its ceiling at about 37.5 kB.
JavaScript keeps its existing ceilings and the production build uses the existing
four Terser compression passes.

The integrating task owns the fresh production build, full checks, final measurements
and published evidence. A partial viewport/speed run establishes only that scope.

## Production probe, November 17, 2026

Build `2b71f0ed` (`main.960d1ed3.js`) passed all nine phase/lighting/timing journeys
at 1280, 390 and 360 px. The separate physical-map/acquisition/state matrix passed
18 cases across the same viewports and both themes. All measured speed windows
included actual panning and a rendered month rollover. These runs used two headless
browser workers on the shared development machine.

The reported backend was ANGLE Vulkan **SwiftShader**, a software renderer. GPU
timer queries were unsupported; there are no measured hardware-GPU durations.
CPU draw submission p95 was approximately 0.1 ms in every window, at the browser's
timer precision. Callback-gap p95 values were:

- Desktop 1280 px: 25.1 ms at 1× and 25.8 ms at 12×; desktop 1440 px: 33.4 ms at 24×.
- Phone viewport 390 px: 17.0 ms at 1× and 25.0 ms at 12×.
- Phone viewport 360 px: 8.5 ms at 1× and 16.7 ms at 12×.

The desktop scene reached 31,600 submitted triangles, 51 draw calls and 35 retained
meshes. The 390 px scene reached 21,208 triangles, 45 draw calls and 45 retained
meshes; 360 px reached 18,986 triangles, 43 draw calls and 38 meshes. Raw window,
panning, long-task and counter samples are retained in the corresponding
`map-3d-performance.json` output files. Exact saved near-noon minutes are retained
in `daylight-map-time.json` beside each successful theme/viewport journey.

This software-renderer run does **not** establish the hardware performance budget:
desktop callback cadence misses 120 Hz, and the 390 px 12× window misses 60 Hz.
The windowless Metal follow-up below supplies hardware-GPU evidence; real-phone
verification remains outstanding. No target, timing
ceiling, simulation baseline or bundle ceiling was changed to accommodate this run.

### Windowless Metal follow-up

The same immutable production build subsequently ran on the installed headless
Chromium 151.0.7922.34 with a git-ignored configuration adding `--enable-gpu` and
`--use-angle=metal` while retaining every normal launch argument. It opened no
window and changed no shipped browser behavior or CI launch default. The actual
backend reported **ANGLE Metal Renderer: Apple M5 Max**. All three production
timing journeys passed with one browser worker, including their real pan and
month-rollover windows.

Hardware GPU timer queries returned 8,305 valid samples across all seven speed
windows, with zero disjoint samples. CPU draw-submission p95 was approximately
0.1 ms throughout. GPU draw-interval p95 was 0.381/0.375/0.364 ms for desktop
1×/12×/24×, 0.203/0.200 ms at 390 px, and 0.199/0.198 ms at 360 px. Desktop 1×/12×
used 1280 px; the existing 24× control used 1440 px. All GPU draw intervals were
well within half of the existing desktop frame budget.

Callback-gap p95 was 8.4/8.7/8.4 ms for desktop 1×/12×/24×, 8.4/8.4 ms at 390 px,
and 8.5/8.9 ms at 360 px. Panning p95 ranged from 8.4 to 9.1 ms. Raw reports remain
under `.tmp/metal-performance-results`, with backend/build identity, individual
samples, geometry/resource counts and actual rollover evidence. These measurements
bound the map's draw work; they do not measure physical presentation or every UI
and browser cost. Phone viewports still use the M5 Max GPU. The frame targets
above apply to measurements on physical phones.
