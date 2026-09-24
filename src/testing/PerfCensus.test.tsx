import React from "react";
import { render } from "@testing-library/react";
import { createPerfCensus, PERF_IGNORE_ATTRIBUTE } from "./PerfCensus";
import { budgetVerdict, frameStats, perfOverlayEnabled } from "./PerfOverlay";

function fakeStore() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => ({
      game: { date: { minute: 45, monthsElapsed: 2 }, speed: "FAST" },
    }),
    dispatch: () => listeners.forEach((listener) => listener()),
  };
}

describe("PerfCensus", () => {
  it("counts commits, dispatches and mutations, and resets them", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = fakeStore();
    const census = createPerfCensus(store, host);
    const Label = ({ text }: { text: string }) => <span>{text}</span>;

    const view = render(census.wrap(<Label text="a" />), { container: host });
    view.rerender(census.wrap(<Label text="b" />));
    store.dispatch();
    let snapshot = census.snapshot();
    expect(snapshot.commits).toBe(2);
    expect(snapshot.mountCommits).toBe(1);
    expect(snapshot.updateCommits).toBe(1);
    expect(snapshot.dispatches).toBe(1);
    expect(snapshot.addedNodes).toBeGreaterThan(0);
    expect(snapshot.textMutations).toBe(1);
    expect(snapshot.game).toEqual({
      minute: 45,
      monthsElapsed: 2,
      speed: "FAST",
    });

    census.reset();
    const ignored = document.createElement("div");
    ignored.setAttribute(PERF_IGNORE_ATTRIBUTE, "");
    host.appendChild(ignored);
    ignored.textContent = "overlay";
    snapshot = census.snapshot();
    expect(snapshot.commits).toBe(0);
    expect(snapshot.dispatches).toBe(0);
    // Only the append itself is outside the ignored element
    expect(snapshot.mutationRecords).toBe(1);

    view.unmount();
    census.dispose();
    host.remove();
  });
});

describe("PerfOverlay", () => {
  it("reads and remembers the query flag", () => {
    localStorage.clear();
    expect(perfOverlayEnabled("")).toBe(false);
    expect(perfOverlayEnabled("?perf=1")).toBe(true);
    expect(perfOverlayEnabled("")).toBe(true);
    expect(perfOverlayEnabled("?perf=0")).toBe(false);
    expect(perfOverlayEnabled("")).toBe(false);
  });

  it("derives fps, refresh rate and the worst gap from the last second", () => {
    // The first stamp is over a second old and drops out of the window
    const stamps = [0, 1100, 1108, 1116, 1141, 1149];
    expect(frameStats(stamps, 1200)).toEqual({
      fps: 5,
      refreshHz: 125,
      worstGapMs: 25,
    });
    expect(frameStats([], 0)).toEqual({ fps: 0, refreshHz: 0, worstGapMs: 0 });
  });

  it("labels frame gaps against both budgets", () => {
    expect(budgetVerdict(8.3).label).toBe("OK at 120 Hz");
    expect(budgetVerdict(16.6).label).toBe("OK at 60 Hz only");
    expect(budgetVerdict(40).label).toBe("over 60 Hz budget");
  });
});
