import uPlot from "uplot";
import {
  eventMarkersPlugin,
  spansBelow,
  splitPastProjected,
} from "./UPlotHelpers";

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
