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
their input changes. Hidden documents, invisible surfaces and wholly culled motion
stop scheduling frames. A paused simulation leaves decorative production motion at
25%; operation pause, idle, construction, reduced motion and visibility suspension
preserve each facility's phase. Lighting uses the simulated minute and the existing
sunrise/sunset calculation. Wall-clock time never advances sunlight.

## Inspecting actual geometry

`canvas.map3DDiagnostics()` samples current frame counters, CPU submission duration,
phase, playback rate, visibility and actual lighting inputs. `frameMs` remains a
compatibility alias of `cpuFrameMs`. These durations exclude asynchronous GPU
execution, browser compositing and physical presentation.

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
samples, browser/build/backend identity, callback gaps, CPU submission, long tasks,
draw/triangle counts and peak mesh/instance counts. Samples and pending GPU queries
are bounded.

Where the browser exposes `EXT_disjoint_timer_query_webgl2`, test-only instrumentation
times the map's actual draw interval with GPU queries. Unavailable timers are reported
as unsupported; disjoint query results are counted and discarded. A missing GPU timer
is never replaced with CPU submission time. The measurement records ordinary and
panning callback windows separately and retains the rendered month boundaries.

The existing goals remain 120 Hz / 8.33 ms for desktop and 60 Hz / 16.67 ms for
phones, with roughly half the frame available for presentation and tick work. These
are lab reports, following `e2e/frame-budget.spec.ts`, rather than machine-dependent
CI timing gates. Callback cadence cannot prove physical presentation, a 60 Hz
headless callback stream cannot demonstrate 120 Hz, and viewport emulation cannot
certify a phone GPU. Report those limits together with results. The existing bundle,
simulation and tick-performance ceilings remain unchanged.

The integrating task owns the fresh production build, full checks, final measurements
and published evidence. A partial viewport/speed run establishes only that scope.
