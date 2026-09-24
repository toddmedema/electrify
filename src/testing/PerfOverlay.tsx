// Development-only frame budget readout (benchmark B6 in docs/perf-plan.md). Enable with
// `?perf=1` (remembered in localStorage) and disable with `?perf=0`. src/index.tsx loads this
// module only outside production builds. It is plain DOM, not React, so it adds no commits to
// the B3/B4 census, and its element carries the census ignore attribute.
import { PERF_IGNORE_ATTRIBUTE } from "./PerfCensus";

const STORAGE_KEY = "perfOverlay";
const WINDOW_MS = 1000;
const LONG_TASK_WINDOW_MS = 5000;
const PAINT_INTERVAL_MS = 250;
export const BUDGET_120HZ_MS = 1000 / 120;
export const BUDGET_60HZ_MS = 1000 / 60;

/** Reads `?perf=` and the remembered choice; `?perf=1|0` also updates the memory. */
export function perfOverlayEnabled(
  search: string = window.location.search,
): boolean {
  const param = new URLSearchParams(search).get("perf");
  try {
    if (param === "1") {
      localStorage.setItem(STORAGE_KEY, "1");
    } else if (param === "0") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the query param still works
  }
  if (param === "1" || param === "0") {
    return param === "1";
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export interface FrameStats {
  fps: number;
  refreshHz: number;
  worstGapMs: number;
}

/** Stats over rAF timestamps (ms, ascending) within the last second before `now`. */
export function frameStats(timestamps: number[], now: number): FrameStats {
  const recent = timestamps.filter((t) => t > now - WINDOW_MS);
  const deltas: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    deltas.push(recent[i] - recent[i - 1]);
  }
  if (!deltas.length) {
    return { fps: recent.length, refreshHz: 0, worstGapMs: 0 };
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    fps: recent.length,
    refreshHz: median > 0 ? 1000 / median : 0,
    worstGapMs: sorted[sorted.length - 1],
  };
}

/** Text label and color for a frame gap; the label carries the meaning, color only echoes it. */
export function budgetVerdict(gapMs: number): { label: string; color: string } {
  if (gapMs <= BUDGET_120HZ_MS + 0.5) {
    return { label: "OK at 120 Hz", color: "#3ddc84" };
  }
  if (gapMs <= BUDGET_60HZ_MS + 0.5) {
    return { label: "OK at 60 Hz only", color: "#ffc53d" };
  }
  return { label: "over 60 Hz budget", color: "#ff6b6b" };
}

/** Mounts the readout and returns a disposer. */
export function mountPerfOverlay(): () => void {
  const panel = document.createElement("div");
  panel.setAttribute(PERF_IGNORE_ATTRIBUTE, "");
  panel.setAttribute("aria-hidden", "true");
  Object.assign(panel.style, {
    position: "fixed",
    left: "8px",
    bottom: "8px",
    zIndex: "2147483647",
    pointerEvents: "none",
    padding: "4px 8px",
    borderRadius: "4px",
    background: "rgba(10, 14, 20, 0.82)",
    color: "#e8edf3",
    font: "11px/16px ui-monospace, SFMono-Regular, Menlo, monospace",
    whiteSpace: "pre",
  } as Partial<CSSStyleDeclaration>);
  const summary = document.createElement("div");
  const worst = document.createElement("div");
  const task = document.createElement("div");
  panel.append(summary, worst, task);
  document.body.appendChild(panel);

  const timestamps: number[] = [];
  const longTasks: { at: number; duration: number }[] = [];
  let observer: PerformanceObserver | undefined;
  const longTaskSupported =
    typeof PerformanceObserver !== "undefined" &&
    (PerformanceObserver.supportedEntryTypes ?? []).includes("longtask");
  if (longTaskSupported) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({
          at: entry.startTime + entry.duration,
          duration: entry.duration,
        });
      }
    });
    observer.observe({ type: "longtask", buffered: false });
  }

  let lastPaint = 0;
  let frame = 0;
  const loop = (now: number) => {
    timestamps.push(now);
    while (timestamps.length && timestamps[0] <= now - WINDOW_MS) {
      timestamps.shift();
    }
    if (now - lastPaint >= PAINT_INTERVAL_MS) {
      lastPaint = now;
      const stats = frameStats(timestamps, now);
      const verdict = budgetVerdict(stats.worstGapMs);
      summary.textContent = `${stats.fps} fps  ~${Math.round(stats.refreshHz)} Hz display`;
      worst.textContent = `worst gap ${stats.worstGapMs.toFixed(1)} ms: ${verdict.label}`;
      worst.style.color = verdict.color;
      while (longTasks.length && longTasks[0].at <= now - LONG_TASK_WINDOW_MS) {
        longTasks.shift();
      }
      if (!longTaskSupported) {
        task.textContent = "long tasks: not supported";
        task.style.color = "";
      } else {
        const longest = Math.max(0, ...longTasks.map((t) => t.duration));
        task.textContent = longest
          ? `longest task (5 s) ${Math.round(longest)} ms`
          : "longest task (5 s) none over 50 ms";
        task.style.color = longest ? budgetVerdict(longest).color : "";
      }
    }
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    panel.remove();
  };
}

export function installPerfOverlay(): void {
  if (perfOverlayEnabled()) {
    mountPerfOverlay();
  }
}
