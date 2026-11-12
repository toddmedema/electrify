import uPlot from "uplot";
import {
  anchoredForecastPaths,
  baselinePlugin,
  eventBadgeText,
  eventMarkersPlugin,
  hoverPoints,
  spansBelow,
  splitPastProjected,
  chartFont,
  chartScale,
  xAxis,
  yAxis,
  niceSplits,
  patternFill,
  shortfallSkyline,
  shortfallBarsPlugin,
  zeroLinePlugin,
} from "./UPlotHelpers";
import { applyTextSize } from "../../TextSize";
import { chartPalette } from "../../Theme";

it("enlarges canvas labels and their reserved chart space with the text preference", () => {
  const values = () => ["100MW"];
  try {
    applyTextSize("standard");
    const standardScale = chartScale(350);
    const standardAxis = xAxis(standardScale, { values });
    expect(chartFont()).toMatch(/^12px /);
    applyTextSize("larger");
    const largerScale = chartScale(350);
    expect(chartFont()).toMatch(/^15px /);
    expect(chartFont(2)).toMatch(/^30px /);
    expect(largerScale).toBeGreaterThan(standardScale);
    expect(xAxis(largerScale, { values }).size).toBeGreaterThan(
      standardAxis.size as number,
    );
    expect(yAxis(largerScale, { values, size: 60 }).size).toBe(75);
  } finally {
    applyTextSize("standard");
  }
});

describe("anchored forecast dashes", () => {
  class RecordedPath {
    commands: Array<[string, ...number[]]> = [];
    moveTo(x: number, y: number) {
      this.commands.push(["move", x, y]);
    }
    lineTo(x: number, y: number) {
      this.commands.push(["line", x, y]);
    }
    rect(x: number, y: number, width: number, height: number) {
      this.commands.push(["rect", x, y, width, height]);
    }
  }
  const originalPath = window.Path2D;
  beforeEach(() => {
    window.Path2D = RecordedPath as unknown as typeof Path2D;
  });
  afterEach(() => {
    window.Path2D = originalPath;
  });
  const plot = (past: Array<number | null>, projected: Array<number | null>) =>
    ({
      data: [[0, 1, 2, 3], past, projected],
      series: [{}, {}, { scale: "energy" }],
      bbox: { left: 20, top: 10, width: 30, height: 100 },
      valToPos: (value: number, scale: string, canvas: boolean) => {
        expect(canvas).toBe(true);
        return scale === "x" ? 20 + value * 10 : value * 10;
      },
    }) as unknown as uPlot;
  const commands = (path: unknown) => (path as RecordedPath).commands;

  it("keeps the identical stroke when time advances and only moves the forecast clip", () => {
    const first = plot([1, 2, null, null], [null, 2, 3, 4]);
    const next = plot([1, 2, 3, null], [null, null, 3, 4]);
    const paths = anchoredForecastPaths(1);
    const initial = paths(first, 2, 1, 3)!;
    const advanced = paths(next, 2, 2, 3)!;
    expect(commands(initial.stroke)).toEqual([
      ["move", 20, 10],
      ["line", 30, 20],
      ["line", 40, 30],
      ["line", 50, 40],
    ]);
    expect(commands(advanced.stroke)).toEqual(commands(initial.stroke));
    expect(commands(initial.clip)).toEqual([["rect", 30, 10, 20, 100]]);
    expect(commands(advanced.clip)).toEqual([["rect", 40, 10, 10, 100]]);
    expect(next.data[2]).toEqual([null, null, 3, 4]);
  });

  it("preserves real gaps and draws nothing for a wholly recorded series", () => {
    const paths = anchoredForecastPaths(1);
    const result = paths(
      plot([1, null, 3, null], [null, null, 3, 4]),
      2,
      2,
      3,
    )!;
    expect(commands(result.stroke)).toEqual([
      ["move", 20, 10],
      ["move", 40, 30],
      ["line", 50, 40],
    ]);
    expect(
      paths(plot([1, 2, 3, 4], [null, null, null, null]), 2, 0, 3),
    ).toBeNull();
  });
});

it("draws the baseline solid after a dashed forecast across the whole plot", () => {
  let dash = [8, 4];
  const ctx = {
    save: jest.fn(),
    restore: jest.fn(),
    setLineDash: (value: number[]) => {
      dash = value;
    },
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(() => expect(dash).toEqual([])),
  };
  const plot = {
    bbox: { left: 20, top: 10, width: 300, height: 100 },
    ctx,
  } as unknown as uPlot;
  (baselinePlugin("black").hooks!.draw as (plot: uPlot) => void)(plot);
  expect(ctx.moveTo).toHaveBeenCalledWith(20, expect.any(Number));
  expect(ctx.lineTo).toHaveBeenCalledWith(320, expect.any(Number));
  expect(ctx.stroke).toHaveBeenCalledTimes(1);
});

it("draws the zero rule solid across the plot, clipped to it", () => {
  let dash = [8, 4];
  const ctx = {
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    rect: jest.fn(),
    clip: jest.fn(),
    setLineDash: (value: number[]) => {
      dash = value;
    },
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(() => expect(dash).toEqual([])),
  };
  const plot = {
    bbox: { left: 20, top: 10, width: 300, height: 100 },
    ctx,
    valToPos: (value: number, scale: string, canvas: boolean) => {
      expect([value, scale, canvas]).toEqual([0, "y", true]);
      return 40;
    },
  } as unknown as uPlot;
  (zeroLinePlugin("black").hooks!.draw as (plot: uPlot) => void)(plot);
  expect(ctx.rect).toHaveBeenCalledWith(20, 10, 300, 100);
  expect(ctx.moveTo).toHaveBeenCalledWith(20, 40);
  expect(ctx.lineTo).toHaveBeenCalledWith(320, 40);
  expect(ctx.stroke).toHaveBeenCalledTimes(1);
});

describe("patternFill", () => {
  const strokes: Array<Array<[number, number]>> = [];
  const originalCreate = document.createElement.bind(document);
  beforeEach(() => {
    strokes.length = 0;
    jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") return originalCreate(tag);
      let path: Array<[number, number]> = [];
      const ctx = {
        scale: jest.fn(),
        fillRect: jest.fn(),
        beginPath: jest.fn(() => (path = [])),
        moveTo: (x: number, y: number) => path.push([x, y]),
        lineTo: (x: number, y: number) => path.push([x, y]),
        stroke: () => strokes.push(path),
      };
      return {
        getContext: () => ctx,
      } as unknown as HTMLCanvasElement;
    });
  });
  afterEach(() => jest.restoreAllMocks());
  const draw = (kind: "hatch" | "vertical") => {
    const pattern = {} as CanvasPattern;
    const createPattern = jest.fn(() => pattern);
    const fill = patternFill(kind) as (u: uPlot) => unknown;
    const u = { ctx: { createPattern } } as unknown as uPlot;
    return { result: fill(u), again: fill(u), createPattern, pattern };
  };

  it("tells a vertical rule from a diagonal one, and builds each tile once", () => {
    const vertical = draw("vertical");
    expect(vertical.result).toBe(vertical.pattern);
    expect(vertical.again).toBe(vertical.pattern);
    expect(vertical.createPattern).toHaveBeenCalledTimes(1);
    expect(strokes[0]).toEqual([
      [8.5, 0],
      [8.5, 16],
    ]);

    strokes.length = 0;
    draw("hatch");
    expect(strokes[0]).toEqual([
      [-8, 16],
      [16, -8],
      [8, 16],
      [16, 8],
    ]);
  });

  it("falls back to the flat wash when the canvas can't make a pattern", () => {
    const fill = patternFill("vertical") as (u: uPlot) => unknown;
    const u = { ctx: { createPattern: () => null } } as unknown as uPlot;
    expect(typeof fill(u)).toBe("string");
  });
});

describe("eventMarkersPlugin", () => {
  it("draws numbered in-domain event markers and skips events outside the plot", () => {
    const ctx = {
      arc: jest.fn(),
      beginPath: jest.fn(),
      clip: jest.fn(),
      fill: jest.fn(),
      fillText: jest.fn(),
      moveTo: jest.fn(),
      rect: jest.fn(),
      restore: jest.fn(),
      save: jest.fn(),
      setLineDash: jest.fn(),
      stroke: jest.fn(),
      lineTo: jest.fn(),
      measureText: jest.fn((text: string) => ({ width: text.length * 7 })),
    } as unknown as CanvasRenderingContext2D;
    const plot = {
      bbox: { left: 0, top: 40, width: 100, height: 80 },
      ctx,
      scales: { x: { min: 0, max: 10 } },
      valToPos: (value: number) => value * 10,
      width: 350,
    } as unknown as uPlot;
    const plugin = eventMarkersPlugin(
      () => [
        { key: "inside", x: 5, number: 1 },
        { key: "outside", x: 15, number: 2 },
      ],
      () => "inside",
    );

    (plugin.hooks!.draw as (plot: uPlot) => void)(plot);

    const options = {
      width: 350,
      height: 160,
      padding: [10, 0, 0, 0],
    } as uPlot.Options;
    plugin.opts!(plot, options);
    const topPadding = options.padding![0] as (...args: unknown[]) => number;
    expect(topPadding(plot, 0, [], 0)).toBe(34);
    expect(ctx.moveTo).toHaveBeenCalledWith(50.5, 40);
    expect(ctx.moveTo).toHaveBeenCalledTimes(2);
    expect(ctx.fillText).toHaveBeenCalledWith("1", 50.5, 28);
    // The badge's lower edge stays above the data, in its reserved event row.
    expect(ctx.arc).toHaveBeenCalledWith(50.5, 28, 8, 0, Math.PI * 2);
    expect(ctx.fillText).not.toHaveBeenCalledWith(
      "2",
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.save).toHaveBeenCalledTimes(2);
    expect(ctx.restore).toHaveBeenCalledTimes(2);
  });

  it("merges close and edge-clamped badges in one row while keeping true onset guides", () => {
    const groupStrokeWidths: number[] = [];
    const ctx = {
      arc: jest.fn(),
      roundRect: jest.fn(function (this: CanvasRenderingContext2D) {
        groupStrokeWidths.push(this.lineWidth);
      }),
      beginPath: jest.fn(),
      clip: jest.fn(),
      fill: jest.fn(),
      fillText: jest.fn(),
      measureText: (text: string) => ({ width: text.length * 7 }),
      moveTo: jest.fn(),
      rect: jest.fn(),
      restore: jest.fn(),
      save: jest.fn(),
      setLineDash: jest.fn(),
      stroke: jest.fn(),
      lineTo: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    const plot = {
      bbox: { left: 0, top: 40, width: 100, height: 80 },
      ctx,
      scales: { x: { min: 0, max: 10 } },
      valToPos: (value: number) => value * 10,
      width: 350,
    } as unknown as uPlot;
    const plugin = eventMarkersPlugin(
      () => [
        { key: "freeze", x: 0, number: 1 },
        { key: "recovery", x: 0.25, number: 2 },
        { key: "nearby", x: 2.5, number: 3 },
        { key: "later", x: 9.9, number: 4 },
      ],
      () => "recovery",
    );
    (plugin.hooks.draw as (plot: uPlot) => void)(plot);
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    expect(ctx.fillText).toHaveBeenCalledWith("1–3", 14.5, 28);
    expect(ctx.fillText).toHaveBeenCalledWith("4", 92, 28);
    expect(ctx.moveTo).toHaveBeenCalledWith(0.5, 40);
    expect(ctx.moveTo).toHaveBeenCalledWith(3.5, 40);
    expect(ctx.moveTo).toHaveBeenCalledWith(25.5, 40);
    expect(ctx.roundRect).toHaveBeenCalledTimes(1);
    expect(groupStrokeWidths).toEqual([2]);
    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect(ctx.arc).toHaveBeenCalledWith(92, 28, 8, 0, Math.PI * 2);
  });
});

describe("event badge tooltips", () => {
  const canvas = () =>
    ({
      arc: jest.fn(),
      roundRect: jest.fn(),
      beginPath: jest.fn(),
      clip: jest.fn(),
      fill: jest.fn(),
      fillText: jest.fn(),
      measureText: (text: string) => ({ width: text.length * 7 }),
      moveTo: jest.fn(),
      rect: jest.fn(),
      restore: jest.fn(),
      save: jest.fn(),
      setLineDash: jest.fn(),
      stroke: jest.fn(),
      lineTo: jest.fn(),
    }) as unknown as CanvasRenderingContext2D;
  // The plot's wrapper is its coordinate space; jsdom lays nothing out, so a pointer's client
  // position is its position on the wrapper.
  function mount(markers: Parameters<typeof eventMarkersPlugin>[0]) {
    const wrap = document.createElement("div");
    const over = document.createElement("div");
    wrap.appendChild(over);
    const plot = {
      bbox: { left: 0, top: 40, width: 100, height: 80 },
      ctx: canvas(),
      over,
      scales: { x: { min: 0, max: 10 } },
      valToPos: (value: number) => value * 10,
      width: 350,
    } as unknown as uPlot;
    const plugin = eventMarkersPlugin(markers, () => undefined);
    (plugin.hooks.init as (plot: uPlot) => void)(plot);
    (plugin.hooks.draw as (plot: uPlot) => void)(plot);
    const hover = (clientX: number, clientY: number) => {
      wrap.dispatchEvent(
        new MouseEvent("mousemove", { clientX, clientY, bubbles: true }),
      );
      const tooltip = wrap.querySelector<HTMLElement>(".chartEventTooltip")!;
      return tooltip.style.display === "block" ? tooltip.textContent : null;
    };
    return { wrap, plugin, plot, hover };
  }

  it("names the event under the pointer and nothing else", () => {
    const { hover, wrap } = mount(() => [
      { key: "fee", x: 5, number: 1, title: "Higher carbon fee begins" },
    ]);
    // The badge is drawn at (50.5, 28) with a radius of 8, in the row above the plot.
    expect(hover(50, 28)).toBe("Higher carbon fee begins");
    expect(hover(57, 24)).toBe("Higher carbon fee begins");
    // Over the plot and beside the badge there is nothing to name.
    expect(hover(50, 60)).toBeNull();
    expect(hover(80, 28)).toBeNull();
    expect(hover(50, 28)).toBe("Higher carbon fee begins");
    wrap.dispatchEvent(new MouseEvent("mouseleave"));
    expect(
      wrap.querySelector<HTMLElement>(".chartEventTooltip")!.style.display,
    ).toBe("none");
  });

  it("lists every event of a merged badge on its own line with its number", () => {
    const { hover } = mount(() => [
      { key: "freeze", x: 0, number: 1, title: "Cold snap" },
      { key: "recovery", x: 0.25, number: 2, title: "Fuel shortage" },
      { key: "nearby", x: 2.5, number: 3 },
      { key: "later", x: 9.9, number: 4, title: "Carbon fee" },
    ]);
    // The first three merge into the "1–3" badge at x = 14.5; the fourth keeps its own.
    expect(hover(14, 28)).toBe(
      "1. Cold snap\n2. Fuel shortage\n3. Scenario event",
    );
    expect(hover(92, 28)).toBe("Carbon fee");
  });

  it("follows the badges as they are redrawn and stops listening when destroyed", () => {
    let markers = [{ key: "a", x: 5, number: 1, title: "First" }];
    const { hover, plot, plugin, wrap } = mount(() => markers);
    expect(hover(50, 28)).toBe("First");
    markers = [{ key: "a", x: 9, number: 1, title: "Moved" }];
    (plugin.hooks.draw as (plot: uPlot) => void)(plot);
    expect(hover(50, 28)).toBeNull();
    expect(hover(90, 28)).toBe("Moved");
    (plugin.hooks.destroy as (plot: uPlot) => void)(plot);
    expect(wrap.querySelector(".chartEventTooltip")).toBeNull();
  });

  it("describes one event by its name and several by number", () => {
    expect(
      eventBadgeText([{ key: "a", x: 0, number: 3, title: "Heat wave" }]),
    ).toBe("Heat wave");
    expect(
      eventBadgeText([
        { key: "a", x: 0, number: 1, title: "Heat wave" },
        { key: "b", x: 1, number: 2, title: "Drought" },
      ]),
    ).toBe("1. Heat wave\n2. Drought");
  });
});

describe("hoverPoints", () => {
  const surface = () => chartPalette().background;
  const plot = (strokes: Array<string | null | (() => string)>) =>
    ({
      series: [
        {},
        ...strokes.map((stroke) => ({
          stroke: typeof stroke === "function" ? stroke : () => stroke,
        })),
      ],
    }) as unknown as uPlot;

  it("marks each drawn line in its own colour, ringed in the chart surface", () => {
    const points = hoverPoints();
    const u = plot(["#0a84ff", () => "#ff9f0a"]);
    for (const [index, color] of [
      [1, "#0a84ff"],
      [2, "#ff9f0a"],
    ] as const) {
      const dot = (points.show as (u: uPlot, i: number) => HTMLElement)(
        u,
        index,
      );
      expect(dot.hidden).toBe(false);
      expect(dot.style.borderWidth).toBe("2px");
      expect((points.fill as (u: uPlot, i: number) => string)(u, index)).toBe(
        color,
      );
    }
    expect((points.stroke as (u: uPlot, i: number) => string)(u, 1)).toBe(
      surface(),
    );
    expect(points.size).toBe(10);
  });

  it("leaves filled areas and stacked-area separators unmarked", () => {
    const points = hoverPoints();
    const u = plot([null, () => surface()]);
    for (const index of [1, 2]) {
      const dot = (points.show as (u: uPlot, i: number) => HTMLElement)(
        u,
        index,
      );
      expect(dot.hidden).toBe(true);
    }
  });

  it("prefers the colour a series was last drawn with", () => {
    const points = hoverPoints();
    const u = plot(["#0a84ff"]);
    (u.series[1] as unknown as { _stroke: string })._stroke = "#30d158";
    expect((points.fill as (u: uPlot, i: number) => string)(u, 1)).toBe(
      "#30d158",
    );
  });
});

describe("splitPastProjected", () => {
  it("leaves a wholly recorded series on the solid half", () => {
    const split = splitPastProjected([1, 2, 3], [false, false, false]);
    expect(split.past).toEqual([1, 2, 3]);
    expect(split.projected).toEqual([null, null, null]);
  });

  it("leaves a wholly projected series on the dashed half", () => {
    const split = splitPastProjected([1, 2, 3], [true, true, true]);
    expect(split.past).toEqual([null, null, null]);
    expect(split.projected).toEqual([1, 2, 3]);
  });

  it("starts the dashed half at the last recorded point so the halves meet", () => {
    const split = splitPastProjected([1, 2, 3, 4], [false, false, true, true]);
    expect(split.past).toEqual([1, 2, null, null]);
    expect(split.projected).toEqual([null, 2, 3, 4]);
  });

  it("can also end the solid half at the first projected point", () => {
    const split = splitPastProjected([1, 2, 3, 4], [false, false, true, true], {
      bridgeEnd: true,
    });
    expect(split.past).toEqual([1, 2, 3, null]);
    expect(split.projected).toEqual([null, 2, 3, 4]);
  });

  it("ignores nulls when locating the boundary", () => {
    const split = splitPastProjected(
      [1, null, 2, 3, null],
      [false, false, false, true, true],
      { bridgeEnd: true },
    );
    expect(split.past).toEqual([1, null, 2, 3, null]);
    expect(split.projected).toEqual([null, null, 2, 3, null]);
  });

  it("bridges nowhere when the series is empty", () => {
    const split = splitPastProjected([], [], { bridgeEnd: true });
    expect(split.past).toEqual([]);
    expect(split.projected).toEqual([]);
  });
});

describe("spansBelow", () => {
  it("is quiet where the series never sinks below the threshold", () => {
    expect(spansBelow([0, 1, 2], [0, 5, 1])).toEqual([]);
  });

  it("runs a band from the crossing in to the crossing out", () => {
    const spans = spansBelow([0, 1, 2, 3], [1, -1, -2, 1]);
    expect(spans).toHaveLength(1);
    expect(spans[0][0]).toBeCloseTo(0.5);
    expect(spans[0][1]).toBeCloseTo(8 / 3);
  });

  it("counts a single sub-threshold sample as a band between its crossings", () => {
    const spans = spansBelow([0, 1, 2], [1, -1, 1]);
    expect(spans).toEqual([[0.5, 1.5]]);
  });

  it("anchors a band to the last sample when the stretch runs to the end", () => {
    const spans = spansBelow([0, 1, 2], [1, -1, -2]);
    expect(spans).toHaveLength(1);
    expect(spans[0][0]).toBeCloseTo(0.5);
    expect(spans[0][1]).toBe(2);
  });

  it("starts a band at the first sample when the series opens below", () => {
    const spans = spansBelow([0, 1, 2], [-1, -2, 1]);
    expect(spans).toHaveLength(1);
    expect(spans[0][0]).toBe(0);
    expect(spans[0][1]).toBeCloseTo(5 / 3);
  });

  it("ends any open stretch at a null, where the split halves meet", () => {
    const spans = spansBelow([0, 1, 2, 3], [1, -1, null, 1]);
    expect(spans).toEqual([[0.5, 1]]);
  });

  it("honours a non-zero threshold", () => {
    const spans = spansBelow([0, 1], [1, -1], 0.5);
    expect(spans).toHaveLength(1);
    expect(spans[0][0]).toBeCloseTo(0.25);
    expect(spans[0][1]).toBe(1);
  });
});

it("uses positive zero for axis ticks crossing a small negative lower bound", () => {
  const ticks = niceSplits(-1, 16500);
  expect(ticks).toEqual([0, 5000, 10000, 15000]);
  expect(ticks.some((value) => Object.is(value, -0))).toBe(false);
  expect(niceSplits(-10000, 10000)).toContain(-5000);
});

it("does not retain negative zero in a degenerate axis", () => {
  expect(niceSplits(-0, -0)).toEqual([0]);
});

describe("shortfallSkyline", () => {
  const plot = { left: 10, width: 100, height: 200 };
  const bar = (x0: number, x1: number, heightShare: number) => ({
    x0,
    x1,
    heightShare,
  });

  it("scales linearly to the plot height, with the cap as the floor", () => {
    const heights = shortfallSkyline(
      [
        bar(10, 20, 0),
        bar(30, 40, 0.25),
        bar(50, 60, 0.5),
        bar(70, 80, 1),
        bar(90, 100, 7),
      ],
      plot,
      8,
    ).map((rect) => rect.height);
    expect(heights).toEqual([8, 50, 100, 200, 200]);
  });

  it("keeps the tallest of several months that share a pixel column", () => {
    expect(
      shortfallSkyline([bar(10, 10.5, 0.9), bar(10.25, 10.75, 0.1)], plot, 8),
    ).toEqual([{ x: 10, width: 0.75, height: 180 }]);
  });

  it("merges equal neighbours and joins unequal ones without a gap or an overlap", () => {
    expect(
      shortfallSkyline(
        [bar(10, 30, 0.5), bar(30, 50, 0.5), bar(50, 70, 0.25)],
        plot,
        8,
      ),
    ).toEqual([
      { x: 10, width: 40, height: 100 },
      { x: 50, width: 20, height: 50 },
    ]);
  });

  it("preserves fractional boundaries and gaps narrower than a pixel", () => {
    expect(shortfallSkyline([bar(40.25, 40.5, 0.1)], plot, 8)).toEqual([
      { x: 40.25, width: 0.25, height: 20 },
    ]);
    expect(
      shortfallSkyline([bar(10, 10.25, 0.9), bar(10.75, 11, 0.1)], plot, 8),
    ).toEqual([
      { x: 10, width: 0.25, height: 180 },
      { x: 10.75, width: 0.25, height: 180 },
    ]);
  });

  it("clips to the plot and drops bars wholly outside it", () => {
    expect(
      shortfallSkyline(
        [bar(0, 25, 0.5), bar(105, 130, 1), bar(200, 220, 1)],
        plot,
        8,
      ),
    ).toEqual([
      { x: 10, width: 15, height: 100 },
      { x: 105, width: 5, height: 200 },
    ]);
  });

  it("paints a cap rather than NaN for an unusable height, and never exceeds the plot", () => {
    expect(shortfallSkyline([bar(10, 20, NaN)], plot, 8)).toEqual([
      { x: 10, width: 10, height: 8 },
    ]);
    expect(
      shortfallSkyline([bar(10, 20, 0.5)], { ...plot, height: 6 }, 8),
    ).toEqual([{ x: 10, width: 10, height: 6 }]);
  });
});

describe("shortfallBarsPlugin MW scale", () => {
  it("uses the rendered Y span, follows scale changes and caps at full height", () => {
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      fillRect: jest.fn(),
    };
    const plot = {
      bbox: { left: 10, top: 20, width: 100, height: 300 },
      ctx,
      scales: { y: { min: 400e6, max: 1e9 } },
      valToPos: (value: number) => value,
    } as unknown as uPlot;
    const plugin = shortfallBarsPlugin(
      () => [{ from: 10, to: 20, peakShortfall: 200e6 }],
      "red",
    );
    const draw = plugin.hooks!.drawClear as (plot: uPlot) => void;
    draw(plot);
    // 200 MW across the rendered 600 MW span is exactly a third of 300 pixels.
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 10, 100);
    ctx.fillRect.mockClear();
    plot.scales.y.max = 800e6;
    draw(plot);
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 10, 150);
    ctx.fillRect.mockClear();
    plot.scales.y.max = 500e6;
    draw(plot);
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 10, 300);
  });
});
