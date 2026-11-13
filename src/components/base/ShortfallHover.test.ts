import uPlot from "uplot";
import {
  shortfallIntervals,
  shortfallAt,
  unmetAt,
  shortfallTooltip,
  shortfallHoverPlugin,
} from "./ShortfallHover";

const timeline = [
  { minute: 0, supplyW: 120e6, demandW: 100e6 },
  { minute: 60, supplyW: 60e6, demandW: 100e6 },
  { minute: 120, supplyW: 90e6, demandW: 100e6 },
  { minute: 180, supplyW: 110e6, demandW: 100e6 },
  { minute: 240, supplyW: 110e6, demandW: 100e6 },
  { minute: 300, supplyW: 80e6, demandW: 100e6 },
];
const intervals = shortfallIntervals(timeline, [
  [20, 150],
  [260, 300],
]);

it("reports coincident peaks for distinct shaded intervals", () => {
  expect(intervals).toEqual([
    { from: 20, to: 150, peakShortfall: 40e6 },
    { from: 260, to: 300, peakShortfall: 20e6, includeEnd: true },
  ]);
  expect(shortfallAt(intervals, 21)).toBe(intervals[0]);
  expect(shortfallAt(intervals, 150)).toBeUndefined();
  expect(shortfallAt(intervals, 200)).toBeUndefined();
  expect(shortfallAt(intervals, 280)).toBe(intervals[1]);
});

it("retains a shortage at the final sample but excludes a recovered endpoint", () => {
  expect(shortfallAt(intervals, 300)).toBe(intervals[1]);
  expect(shortfallTooltip(timeline, intervals, 300)).toContain("20MW unmet");
  expect(shortfallAt(intervals, 300.1)).toBeUndefined();
  const recovered = shortfallIntervals(timeline.slice(0, 4), [[20, 180]]);
  expect(shortfallAt(recovered, 180)).toBeUndefined();
});

it("inspects inside a shortage even when the nearest sample has sufficient supply", () => {
  expect(unmetAt(timeline, 25)).toBe(5e6);
  expect(shortfallTooltip(timeline, intervals, 25)).toBe(" · 5MW unmet");
  expect(shortfallTooltip(timeline, intervals, 170)).toBe("");
  expect(unmetAt([], 25)).toBe(0);
  expect(unmetAt(timeline, -1)).toBe(0);
  expect(unmetAt(timeline, 400)).toBe(20e6);
});

it.each([false, true])(
  "highlights the full interval at every cursor height with scaled height %s",
  (scaleHeight) => {
    const over = document.createElement("div");
    Object.defineProperties(over, {
      clientWidth: { value: 300 },
      clientHeight: { value: 100 },
    });
    const plot = {
      over,
      bbox: { height: 100 * (uPlot.pxRatio || 1) },
      scales: { y: { min: 0, max: 100e6 } },
      cursor: { left: 25, top: 1 },
      posToVal: (value: number) => value,
      valToPos: (value: number) => value,
    } as unknown as uPlot;
    const plugin = shortfallHoverPlugin(() => intervals, { scaleHeight });
    const run = (name: keyof uPlot.Hooks.Arrays) => {
      const hook = plugin.hooks![name];
      (hook as (plot: uPlot) => void)(plot);
    };
    run("init");
    const highlight = over.querySelector<HTMLElement>(
      ".chartShortfallHighlight",
    )!;
    for (const top of [1, 50, 99]) {
      plot.cursor.top = top;
      run("setCursor");
      expect(highlight.hidden).toBe(false);
      expect(highlight.style.left).toBe("20px");
      expect(highlight.style.width).toBe("130px");
      expect(highlight.style.height).toBe(scaleHeight ? "40px" : "100%");
    }
    plot.cursor.left = 155;
    run("setCursor");
    expect(highlight.hidden).toBe(true);
    plot.cursor.left = 280;
    run("setCursor");
    expect(highlight.style.left).toBe("260px");
    expect(highlight.style.width).toBe("40px");
    expect(highlight.style.height).toBe(scaleHeight ? "20px" : "100%");
    plot.cursor.top = -10;
    run("setCursor");
    expect(highlight.hidden).toBe(true);
    run("destroy");
    expect(over.children).toHaveLength(0);
  },
);
