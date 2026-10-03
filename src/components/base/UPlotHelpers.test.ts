import uPlot from "uplot";
import {
  anchoredForecastPaths,
  baselinePlugin,
  eventMarkersPlugin,
  spansBelow,
  splitPastProjected,
} from "./UPlotHelpers";

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
    } as unknown as CanvasRenderingContext2D;
    const plot = {
      bbox: { left: 0, top: 0, width: 100, height: 80 },
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

    expect(ctx.moveTo).toHaveBeenCalledWith(50.5, 0);
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith("1", 50.5, 10);
    expect(ctx.fillText).not.toHaveBeenCalledWith(
      "2",
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
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
