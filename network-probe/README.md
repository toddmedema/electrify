# Reproduce Chromium Issue 572515601 on Windows 11

This document explains how to reproduce
[Chromium Issue 572515601](https://issues.chromium.org/issues/572515601)
on Windows 11 using the Python standard library only. No external packages,
npm modules, or Playwright installations are required.

## Overview

When the `TcpPortRandomizationWin` feature is active, Chromium applies the
`SO_RANDOMIZE_PORT` socket option to outbound TCP connections on Windows. Under
burst connection patterns, new connections intermittently fail with Winsock error
`10055` (`WSAENOBUFS`). Chromium reports this error as
`net::ERR_NO_BUFFER_SPACE` (`-176`), even though the Windows TCP table remains
virtually empty (~150–200 active connections).

This reproduction suite contains two complementary probes:

1. **Native Winsock probe (`native_probe.py`)**: Isolates the Windows kernel
   socket allocator behavior independently of Chromium by alternating between
   ordinary and randomized loopback connections.
2. **Chromium A/B/A probe (`chrome_probe.py`)**: Launches a real Chrome binary
   with `--log-net-log` to demonstrate the browser-level failure, confirms clean
   operation when the feature is disabled, and re-confirms the failure when
   the feature is restored.

Sample results and connection counts in this guide were verified on Windows 11
26H2 (build 26300.9711, kernel `tcpip.sys` version 10.0.26100.8521) using an
official build of **Chrome Dev 157.0.8092.0 (64-bit)**.

## Before you begin

Verify that your system meets the following requirements:

* **Operating system**: 64-bit Windows 11.
* **Python**: 64-bit Python 3.10 or newer (standard library only). If you develop
  Chromium, `vpython3` or `python3` from `depot_tools` can be used directly.
* **Chrome binary**: A recent Chrome build (Dev, Canary, Stable, or portable
  Chrome for Testing), selected in [Choose a Chrome binary](#choose-a-chrome-binary).
* **Reproduction files**: The scripts included in this folder, described in
  [Repository files](#repository-files).

Run all commands in a standard, un-elevated PowerShell window. No administrator
privileges, custom TCP registry modifications, or system tweaks are required.
Chrome tests use an isolated, temporary `--user-data-dir`.

### 1. Verify or install Python

If Python is not yet installed:

1. Visit the [Python Downloads page](https://www.python.org/downloads/windows/).
2. Download and run the **Windows installer (64-bit)** for the current release.
3. Select **Add python.exe to PATH**, then click **Install Now**.
4. Open a new PowerShell window from the Start menu.

Verify that Python is accessible:

```powershell
py -3 --version
```

Confirm that the output reports version 3.10 or newer (such as `Python 3.12.x`
or `Python 3.13.x`). If `py` is unrecognized, run `python --version`.

### 2. Open this folder

1. In File Explorer, navigate to the folder containing `README.md`.
2. Open PowerShell in this folder (for example, hold Shift, right-click an empty
   area in File Explorer, and select **Open PowerShell window here**).
3. Verify the files and create the results directory:

   ```powershell
   Get-ChildItem README.md, LICENSE, native_probe.py, native_probe.c, win_tcp.py, chrome_probe.py, summarize_netlogs.py
   New-Item -ItemType Directory -Force -Path .\results | Out-Null
   ```

### 3. Record the Windows build

Record your Windows version and kernel `tcpip.sys` file version to identify the
host environment when reporting results:

```powershell
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" |
  Select-Object ProductName, DisplayVersion, CurrentBuild, UBR
(Get-Item C:\Windows\System32\drivers\tcpip.sys).VersionInfo.FileVersion
```

---

## Run the reproduction

Execute the following steps in order. First run the native probe to isolate
the kernel socket allocator behavior, then execute the Chrome A/B/A sequence.

The native probe completes in approximately 45 to 50 seconds. A Chrome run that
reproduces `10055` typically halts within 2 to 15 minutes (after 1,000 to 5,500
page loads). A clean 8,000-load run takes approximately 15 to 25 minutes.

### Step 1: Run the native kernel probe

This step exercises the Windows socket layer directly using only Python standard
library modules (`ctypes`, `socket`, `selectors`, `select`, `struct`, and
`threading`). It sets `SO_RANDOMIZE_PORT`, initiates nonblocking loopback
connections, waits on completions via `WSAEventSelect` and `WSAEnumNetworkEvents`,
and performs abortive closes (`SO_LINGER=0`).

1. Run the probe using the default settings (6 alternating phases of 20,000
   connects each, with a batch concurrency of 6):

   ```powershell
   py -3 .\native_probe.py .\results\native.json
   ```

   **Why phases alternate:** The probe toggles between ordinary (`0`) and
   randomized (`1`) phases (`0,1,0,1,0,1`). This alternating structure proves
   that `10055` errors correlate strictly with `SO_RANDOMIZE_PORT`, rather than
   with system uptime, socket accumulation, or `TIME_WAIT` buildup.

2. While the test runs, an intermittent failure appears as:

   ```text
   {"operation": "connect_ex", "error": 10055, "local": {"getsockname_error": 10022}, "tcp_total": 147, "tcp_time_wait": 22}
   ```

   * `getsockname_error: 10022` (`WSAEINVAL`) confirms that the kernel failed to
     assign a local ephemeral port to the socket during the connection attempt.
   * `tcp_total` in the 150–200 range confirms that the failure occurs while the
     global TCP table is nearly empty.

3. When execution finishes, inspect the final summary object:

   ```text
   "summary": {"status": "reproduced", "ordinary_10055": 0, "randomized_10055": 6, ...}
   ```

   * Ordinary phases (`randomized: false`) remain clean with `error_10055: 0`.
   * Randomized phases (`randomized: true`) record intermittent `10055` errors.

Because the defect is timing-sensitive and intermittent, if a run finishes with
`"status": "not_seen"`, run the command a second time.

On Windows 11 26H2 (build 26300.9711), the 120,000-connection test completed in
47.2 seconds. It recorded 6 × `10055` errors across 60,000 randomized connects
(`SO_RANDOMIZE_PORT=1`), and 0 errors across 60,000 ordinary connects
(`SO_RANDOMIZE_PORT=0`). During all failure events, `getsockname` returned
`10022` (`WSAEINVAL`) while active TCP table occupancy was low (~168–191 rows).

*(Note: To compile and run the optional C version of this probe instead, see
[Build the C native probe](#build-the-c-native-probe).)*

---

### Step 2: Choose a Chrome binary

The test supports any current Chrome binary (Canary, Dev, Stable, or portable
Chrome for Testing). Set the `$chrome` environment variable to your chosen
executable.

#### Option A: Official Chrome Dev, Canary, or Stable (Recommended)

Download and install Chrome Dev or Canary from the official channels page:
👉 https://www.chromium.org/getting-involved/dev-channel/

In PowerShell, point `$chrome` to the installed executable:

```powershell
# For Chrome Canary (per-user installation):
$chrome = "$env:LOCALAPPDATA\Google\Chrome SxS\Application\chrome.exe"

# Or for Chrome Dev:
$chrome = "C:\Program Files\Google\Chrome Dev\Application\chrome.exe"

# Or for installed Chrome Stable:
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"

# Confirm the binary exists:
Get-Item $chrome
```

#### Option B: Portable Chrome for Testing (No installation required)

If you prefer not running a system installer, download and extract Google's
portable **Chrome for Testing (CfT)** headless-shell binaries directly:

```powershell
# Download and extract M155 Stable (portable headless shell):
New-Item -ItemType Directory -Force -Path .\browsers\stable | Out-Null
Invoke-WebRequest -Uri "https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.79/win64/chrome-headless-shell-win64.zip" -OutFile ".\browsers\stable\cft-m155.zip"
Expand-Archive -Path ".\browsers\stable\cft-m155.zip" -DestinationPath ".\browsers\stable\" -Force

$chrome = ".\browsers\stable\chrome-headless-shell-win64\chrome-headless-shell.exe"
Get-Item $chrome
```

To test a Canary CfT build (such as 157.x):

```powershell
New-Item -ItemType Directory -Force -Path .\browsers\canary | Out-Null
Invoke-WebRequest -Uri "https://storage.googleapis.com/chrome-for-testing-public/157.0.8102.0/win64/chrome-headless-shell-win64.zip" -OutFile ".\browsers\canary\cft-canary.zip"
Expand-Archive -Path ".\browsers\canary\cft-canary.zip" -DestinationPath ".\browsers\canary\" -Force

$chrome = ".\browsers\canary\chrome-headless-shell-win64\chrome-headless-shell.exe"
Get-Item $chrome
```

> **Note:** `chrome_probe.py` automatically detects whether `$chrome` refers to
> standard `chrome.exe` (adding `--headless=new`) or `chrome-headless-shell.exe`.
> Both executables share the same network stack and reproduce the defect
> identically. The script always includes `--disable-field-trial-config` to
> ensure testing against the compiled default of `TcpPortRandomizationWin`.

---

### Step 3: Smoke-test the Chrome binary

Run a 2-iteration smoke test to verify that the browser launches, navigates, and
flushes its NetLog cleanly:

```powershell
py -3 .\chrome_probe.py .\results\chrome-smoke --chrome $chrome --workers 1 --iterations 2
```

1. Confirm that the terminal output reports `"status": "clean"`, `"completed": 2`,
   and `"netlog_os_error_10055": 0`.
2. Inspect `.\results\chrome-smoke\worker-0-netlog.json`. Verify that the first
   character is an opening brace `{`. If Windows SmartScreen blocks a downloaded
   binary, open the file's **Properties** in File Explorer, select **Unblock**,
   and rerun the smoke test.

---

### Step 4: Run the Chromium A/B/A test

The Chromium test executes an A/B/A sequence:
* **Run A1**: Feature enabled (default or forced on) → Reproduces failure.
* **Run B**: Feature disabled (`--feature-mode disable`) → Operates cleanly.
* **Run A2**: Feature enabled again → Reproduces failure again.

Four Chrome worker processes each load a local test page with 6 script assets,
up to 2,000 times (totaling up to 8,000 page loads). The test halts as soon as
the first missing script or network failure occurs.

#### 1. Run A1: Reproduce with feature enabled

Execute the test using the binary's compiled default:

```powershell
py -3 .\chrome_probe.py .\results\chrome-default --chrome $chrome --feature-mode default
```

*(Note: `--feature-mode default` is the default setting and may be omitted).*

* When the failure reproduces, the test output displays `"status": "reproduced"`,
  for example:

  ```text
  {"status": "reproduced", "completed": 5449, "failures": 1, "netlog_os_error_10055": 2, "no_buffer_space_count": 10, "seconds": 743.86, "feature_mode": "default"}
  ```

* Inspect `.\results\chrome-default\result.json` and `netlog-summary.json`. You
  should observe:
  * A page load where fewer than 6 script requests completed.
  * A NetLog `TCP_CONNECT_ATTEMPT` event with `"os_error": 10055`. Subsequent
    `net_error: -176` (`net::ERR_NO_BUFFER_SPACE`) entries represent this
    underlying connect failure propagating upward through the HTTP transaction layers.
  * Total active TCP connections in the low hundreds.

* **Optional check:** If this initial run completes all 8,000 iterations cleanly,
  the feature may not be enabled by default in that specific build. Force the
  feature on into a separate output directory:

  ```powershell
  py -3 .\chrome_probe.py .\results\chrome-enable --chrome $chrome --feature-mode enable
  ```

  If you force the feature on with `--feature-mode enable`, use
  `.\results\chrome-enable-again` for Run A2.

On Windows 11 26H2 (build 26300.9711), official **Chrome Dev 157.0.8092.0 (64-bit)**
halted at 5,449 completed page loads (743.9 seconds / ~12.4 minutes). Worker 3
failed on iteration 1,303 when `/asset-4.js` failed to load (loading 5 of 6
scripts). The NetLog captured 2 × `TCP_CONNECT_ATTEMPT` events with
`os_error: 10055` and 10 × `net::ERR_NO_BUFFER_SPACE` (`-176`) errors across
workers 0 and 3. (In earlier benchmarks, Canary 157.0.8102.0 halted at iteration
1,869, and Chrome for Testing 155.0.8059.79 halted at iteration 2,957).

#### 2. Run B: Confirm clean operation with feature disabled

Execute the test with `TcpPortRandomizationWin` explicitly disabled:

```powershell
py -3 .\chrome_probe.py .\results\chrome-disable --chrome $chrome --feature-mode disable
```

This injects `--disable-features=TcpPortRandomizationWin`. Allow the test to
complete all 8,000 iterations (approximately 15 to 25 minutes).

Confirm that the output reports `"status": "clean"`, `"failures": 0`, and
`"netlog_os_error_10055": 0`. On Chrome Dev 157.0.8092.0, this run completed all
8,000 page loads (48,000 HTTP script fetches) in 1,056.0 seconds (~17.6 minutes)
with 0 socket errors. (Earlier tests with M155 Stable and Canary 157 also completed
all 8,000 loads cleanly).

#### 3. Run A2: Reproduce again with feature enabled

Re-run the test with the feature enabled to complete the A/B/A demonstration,
matching the mode used in Run A1:

```powershell
# If Run A1 used default:
py -3 .\chrome_probe.py .\results\chrome-default-again --chrome $chrome --feature-mode default

# Or if Run A1 used enable:
py -3 .\chrome_probe.py .\results\chrome-enable-again --chrome $chrome --feature-mode enable
```

Confirm that the test again fails with `os_error: 10055`. On Chrome Dev 157.0.8092.0,
this run reproduced the defect in 284.6 seconds (~4.7 minutes) across 2,095 page
loads. Worker 0 failed on iteration 477 when `/asset-3.js` failed to load,
logging a `TCP_CONNECT_ATTEMPT` event with `os_error: 10055` and 6 ×
`net::ERR_NO_BUFFER_SPACE` errors (`"status": "reproduced"`). (In earlier
benchmarks, Canary 157.0.8102.0 reproduced at iteration 1,024, and M155 Stable
reproduced at iteration 142).

> **Note on TIME_WAIT cooldown:** When thousands of TCP connections close,
> Windows retains them in the `TIME_WAIT` state for `TcpTimedWaitDelay` (120
> to 240 seconds). If you launch a test immediately after Run B, `chrome_probe.py`
> detects these lingering sockets, displays
> `Waiting for N prior closed connections (TIME_WAIT)...`, and pauses until
> the table cools down below 200 rows. It then resumes testing automatically.

---

## Optional procedures

### Build the C native probe

If you have a C compiler installed (MSVC or MinGW) and prefer running a native
executable instead of `native_probe.py`, compile and run `native_probe.c`:

**Using MSVC:**

```powershell
cl /nologo /O2 native_probe.c ws2_32.lib iphlpapi.lib
.\native_probe.exe
```

**Using MinGW (GCC):**

```powershell
gcc -O2 native_probe.c -lws2_32 -liphlpapi -o native_probe.exe
.\native_probe.exe
```

By default, `native_probe.exe` runs 20,000 attempts per phase with modes
`0,1,0,1,0,1`. You can pass custom attempts and phase strings as positional
arguments:

```powershell
.\native_probe.exe 20000 0,1,0,1,0,1
```

### Rebuild a NetLog summary

[`chrome_probe.py`](chrome_probe.py) writes `netlog-summary.json` automatically
upon completion. If you need to re-parse a directory of NetLog files (or a zip
archive containing them) without re-running Chrome, use `summarize_netlogs.py`:

```powershell
py -3 .\summarize_netlogs.py .\results\chrome-default .\results\chrome-default\netlog-summary.json
```

### Inspect live host TCP state

To view your current Windows version, `tcpip.sys` details, dynamic port ranges,
and instantaneous TCP table occupancy, run:

```powershell
py -3 -c "from win_tcp import host_snapshot; import json; print(json.dumps(host_snapshot(), indent=2))"
```

---

## Command-line reference

### `native_probe.py`

```text
py -3 .\native_probe.py DESTINATION [--attempts N] [--modes 0,1,...] [--stop-code CODE]
     [--event-connect | --no-event-connect]
     [--abortive | --no-abortive]
     [--shared-listener | --no-shared-listener]
```

| Argument | Default | Description |
| :--- | :--- | :--- |
| `DESTINATION` | *Required* | Path for the JSON result output (such as `.\results\native.json`). |
| `--attempts` | `20000` | Number of loopback connection attempts per phase. |
| `--modes` | `0,1,0,1,0,1` | Comma-separated phase sequence (`0` = ordinary, `1` = `SO_RANDOMIZE_PORT`). |
| `--stop-code` | *None* | Halts a phase early upon encountering this Winsock error code (`10055`). |
| `--event-connect` | `True` | Uses `WSAEventSelect` and `WSAEnumNetworkEvents` for connection completion. |
| `--no-event-connect` | — | Uses standard socket `select` instead of Win32 events. |
| `--abortive` | `True` | Applies `SO_LINGER=0` (RST) to prevent `TIME_WAIT` socket buildup. |
| `--no-abortive` | — | Closes sockets gracefully via standard TCP FIN teardown. |
| `--shared-listener` | `True` | Reuses a single loopback listener across all phases. |
| `--no-shared-listener` | — | Rebinds a new listener on an ephemeral port for each phase. |

*Batch concurrency is set to 6. The probe aborts if total TCP table rows plus
active attempts exceed 12,500.*

---

### `chrome_probe.py`

```text
py -3 .\chrome_probe.py DIRECTORY --chrome PATH
     [--feature-mode default|enable|disable]
     [--workers N] [--iterations N]
```

| Argument | Default | Description |
| :--- | :--- | :--- |
| `DIRECTORY` | *Required* | Target directory for worker NetLogs and JSON summaries. |
| `--chrome` | *Required* | Path to `chrome.exe` or `chrome-headless-shell.exe`. |
| `--feature-mode` | `default` | Feature toggle: `default` (compiled flag), `enable`, or `disable`. |
| `--workers` | `4` | Number of concurrent Chrome worker processes. |
| `--iterations` | `2000` | Number of page loads per worker (4 × 2,000 = 8,000 total loads). |

**Flags automatically injected into Chrome:**
`--log-net-log`, `--net-log-max-size-mb=128`, `--no-first-run`,
`--no-default-browser-check`, `--disable-sync`, and `--disable-field-trial-config`.
When launching standard `chrome.exe`, `--headless=new` is automatically added.

**Internal safety thresholds:**

| Limit | Value | Description |
| :--- | :--- | :--- |
| Page load timeout | 30 s | Maximum duration to wait for all 6 script requests to complete. |
| Server listen backlog | 128 | Internal HTTP server backlog queue. |
| `TIME_WAIT` cooldown | 200 rows / 300 s | Automatic cooldown limit and timeout when starting a new run. |
| Maximum start occupancy | 2,000 rows | Aborts startup if the TCP table remains crowded after cooldown. |
| Mid-run capacity limit | 11,000 rows | Stops workers immediately if system socket occupancy exceeds this count. |

---

### `summarize_netlogs.py`

```text
py -3 .\summarize_netlogs.py SOURCE DESTINATION
```

| Argument | Default | Description |
| :--- | :--- | :--- |
| `SOURCE` | *Required* | Directory containing NetLog JSON files, or a zip archive. |
| `DESTINATION` | *Required* | Path to write the summarized JSON report. |

---

## Repository files

| File | Description |
| :--- | :--- |
| [`README.md`](README.md) | This reproduction and verification guide. |
| [`LICENSE`](LICENSE) | Public domain dedication ([CC0 1.0 Universal](LICENSE)). |
| [`native_probe.py`](native_probe.py) | Standalone Python probe for Windows `SO_RANDOMIZE_PORT` testing. |
| [`native_probe.c`](native_probe.c) | Optional C implementation of the native probe. |
| [`chrome_probe.py`](chrome_probe.py) | Automated test driver for Chrome binaries with NetLog capture. |
| [`summarize_netlogs.py`](summarize_netlogs.py) | Memory-efficient streaming parser for Chromium NetLog files. |
| [`win_tcp.py`](win_tcp.py) | Helper module for Windows TCP table inspection and host snapshots. |

Execution artifacts are written to `results\` (including NetLogs, worker summaries,
and throwaway Chrome profiles). Python creates `__pycache__\` for cached bytecode.
Neither directory is part of the repository source.

---

## License

This reproduction suite is dedicated to the public domain under the
[Creative Commons CC0 1.0 Universal Public Domain Dedication](LICENSE).
