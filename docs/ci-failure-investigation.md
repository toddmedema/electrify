# October 2026 CI failure investigation

The recurring failures had different causes. A passing retry alone did not distinguish a
product race from broken test setup or a browser transport failure. The fixes below retain
existing assertions, timeouts, retry acceptance, bundle ceilings and simulation baselines.

## PR #626 follow-up: five whys for run 40153602931

The [latest failed run](https://github.com/toddmedema/electrify/actions/runs/40153602931)
failed the Windows production-browser gate. Linux, macOS and Windows packaged Electron
passed. The aggregate `check` failed because Windows failed, not from a separate defect.

### Browser launch regression: fixture settings contaminated the control

1. **Why did Windows fail?** Both browser-environment projects found zero default
   `--disable-features` switches instead of one, including on retries.
2. **Why was the switch absent?** The control launch inherited `ignoreDefaultArgs`
   from the Windows workaround, but replaced its `args` with only `--enable-automation`.
   That combination removed the original switch without adding its replacement.
3. **Why did a manual control launch inherit the workaround?** Playwright Test applies
   the suite's `launchOptions` to manual `chromium.launch()` calls too. The locked
   runtime shallow-merges those options, so overriding `args` does not reset
   `ignoreDefaultArgs`. The Windows trace records that exact combination on the first launch.
4. **Why did local verification miss it?** The suite config enables the workaround
   only on Windows. Calling `browserLaunchOptions("win32")` for the treatment browser
   on macOS exercised flag composition but did not reproduce control contamination.
5. **Why was the regression incomplete?** It covered the adapter in isolation while
   assuming the test runner did not supply ambient launch settings. The experiment's
   control was not explicitly isolated from the behavior under test.

The test now installs the Windows launch fixture on every host and explicitly resets
both `args` and `ignoreDefaultArgs` for its control. Installing that fixture alone
reproduced the exact zero-switch CI assertion on macOS before the reset; adding the
reset passed at desktop and phone project settings. The single-switch and exact default
feature-preservation assertions remain intact. The networking adapter is unchanged.

### Chart geometry: a one-shot measurement raced a deferred rebuild

1. **Why did the chart case fail once?** `plotBounds` was null, causing a property-access
   error before the geometry assertions. A retry passed, but the gate rejects flaky tests.
2. **Why could a resolved plot have no bounds?** Playwright resolves a locator and then
   measures its element. An element detached between those operations has no bounding box.
   The trace resolves `.u-over` immediately after the second tool panel opens; the
   failure screenshot shows a rendered replacement chart.
3. **Why can opening a panel replace the chart?** It changes the available width.
   `UPlotChart` coalesces resize work and later rebuilds the plot after resize settles,
   destroying the previous plot in its effect cleanup.
4. **Why did the test measure before that work finished?** It waited for two visible
   tool panels, which establishes panel presence but not completion of chart layout.
5. **Why was the race unhandled?** The test used one-shot geometry reads with TypeScript
   non-null assertions. Those assertions provide no runtime readiness check, unlike
   Playwright's retrying locator assertions.

The trace and component lifecycle support this rebuild-race diagnosis; the trace does
not capture the exact JavaScript cleanup between the locator and geometry calls.
The test now retries the complete geometry contract within the existing 12-second
assertion budget, reacquiring all three bounds and checking they exist before asserting
divider placement and minimum target height. Persistent missing charts or incorrect
layout still fail. Tooltip, keyboard, touch and shrink assertions remain unchanged.

## Windows loopback allocation

The controller failure in [run 40136399589](https://github.com/toddmedema/electrify/actions/runs/40136399589)
reported a missing focus outline after the production stylesheet failed with
`net::ERR_NO_BUFFER_SPACE`. The cloud-save failure in
[run 40123890295, attempt 2](https://github.com/toddmedema/electrify/actions/runs/40123890295/attempts/2)
followed the same error on `EconomyRaw.csv`. These were failed connections before an HTTP
response, not assertion problems. The stylesheet failure occurred on the first controller
page, so a long-running test-page leak was not necessary to trigger it.

Chromium enables `TcpPortRandomizationWin` on supported Windows versions. This sets
`SO_RANDOMIZE_PORT` before connecting. The Windows allocator can return Winsock 10055
(`WSAENOBUFS`) at low TCP occupancy; Chromium exposes it as `ERR_NO_BUFFER_SPACE`.
The upstream [Windows reproduction](https://github.com/microsoft/playwright/issues/43545)
isolates that socket option independently of the browser. See the
[controlled run using our lockfile](https://github.com/toddmedema/electrify/actions/runs/40150170255)
for native alternating phases, the browser enabled/disabled/restored comparison, host
versions and NetLogs. Its scripts are retained at [diagnostic commit 5070b397](https://github.com/toddmedema/electrify/tree/5070b397/network-probe).

The runner was Windows Server 2025 build 26100.33650, with `tcpip.sys`
10.0.26100.32995 and the locked Chromium 151.0.7922.34. The native test alternated
ordinary/randomized modes three times against one loopback listener:

| Native socket mode    | Connections attempted | Winsock 10055 errors |
| --------------------- | --------------------: | -------------------: |
| Ordinary allocation   |                60,000 |                    0 |
| `SO_RANDOMIZE_PORT=1` |                60,000 |                    2 |

The errors occurred with only 72 and 61 total TCP rows, including 25 and 20
`TIME_WAIT` rows. The dynamic port range contained 16,384 ports. This isolates
randomized allocation failure independently of Chromium, without exhausting ports.

| Locked Chromium phase | Page loads attempted | Result                                                                              |
| --------------------- | -------------------: | ----------------------------------------------------------------------------------- |
| Default               |                2,400 | Clean                                                                               |
| Feature disabled      |                2,400 | Clean                                                                               |
| Default restored      |                1,439 | Missing script; NetLog recorded Winsock 10055 and five `ERR_NO_BUFFER_SPACE` events |

Those five NetLog events describe one failed connection/request propagating through
network layers, not five independent failures. Each phase waited for the previous
phase's closed connections to expire. The browser failure occurred with 5,475 TCP
rows, below the probe's 11,000-row safety stop. Neither clean phase hit that stop.
The first default phase being clean demonstrates the intermittent nature of the bug;
the disabled phase is a measured clean interval, not a guarantee against every network error.

Only Windows Chromium test launches disable the feature. The adapter preserves Playwright's
entire existing disabled-feature list: passing another `--disable-features` by itself
[replaces that list](https://github.com/microsoft/playwright/issues/43557). Node tests and an
actual Chromium command-line check protect the combined switch. The adapter intentionally
uses an isolated internal API from the locked Playwright version; upgrades must pass both
checks. Remove the workaround only after an upstream fix and a repeat of the controlled
Windows comparison. The production Electron application is unchanged.

## Loading completion owned navigation it no longer controlled

In [run 40134255003](https://github.com/toddmedema/electrify/actions/runs/40134255003), the player
opened Achievements from the completion notification while the next tutorial was loading.
`loaded()` and the delayed tutorial callback could subsequently navigate to Facilities,
removing the gallery before its assertion. Both completion paths now preserve the newer
screen, while still initializing the next tutorial objective. Entering loading reserves
a history slot. Completion replaces that slot in place, so Back returns to loading
while data is pending and to the mission afterward, preserving intervening screens.

`loading-navigation.spec.ts` holds the next mission's real data requests, opens the gallery,
and releases the requests. It verifies the gallery survives and that returning to play
reaches the next objective. It failed on the original implementation and passes with the fix
at desktop and phone widths. Reducer/thunk tests separately cover both completion paths and
preserve the existing capstone and stale-game checks.

## Verified data waited for optional persistence

The macOS trace in [run 40130262944](https://github.com/toddmedema/electrify/actions/runs/40130262944)
shows simultaneous weather/market responses taking about ten seconds before the Facilities
assertion timed out. That trace does not identify the exact cause of the historical stall.
Inspection exposed a reproducible dependency: foreground verified-data requests awaited
`cache.put`, even though the caller already had valid network bytes. A delayed optional
cache write could therefore block play.

The service worker now returns verified bytes immediately and retains the write through
`event.waitUntil`. Integrity checks remain before delivery; durable offline synchronization
still waits for storage before advancing its revision; concurrent requests remain coalesced.
A test executing the real worker script holds `cache.put` unresolved and proves both prompt
response delivery and the write's retained lifetime. It fails before the fix. Existing
integrity rejection, offline, persistence-failure and deduplication tests still pass.
This fixes that demonstrated dependency, not a proven explanation of every historical delay.

## Earlier fixes and future evidence

The native Settings failure depended on an unstable body-focus fixture while asynchronous
menu setup could restore focus. The existing clock-controlled helper and focus precondition
fix are already on the base branch; they remain in place.

The shared browser fixture now attaches and prints same-origin transport failures beside
failed UI assertions. `ci:failures` retains those lines. An intentionally aborted stylesheet
request followed by a failed UI assertion verified the real reporter path. This makes future
transport failures directly visible rather than diagnosing them from the final UI symptom.
