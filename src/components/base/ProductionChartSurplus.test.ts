import uPlot from "uplot";
import {
  productionChartSurplus,
  surplusLabels,
} from "./ProductionChartSurplus";

describe("unused surplus labels", () => {
  it("labels a broad gap once and ignores balanced or shortage periods", () => {
    const points = [0, 100, 200].map((x) => ({ x, supplyY: 20, loadY: 80 }));
    expect(surplusLabels(points, 80, 14, 4)).toEqual([{ x: 100, y: 50 }]);
    expect(
      surplusLabels(
        points.map((p) => ({ ...p, loadY: 20 })),
        80,
        14,
        4,
      ),
    ).toEqual([]);
    expect(
      surplusLabels(
        points.map((p) => ({ ...p, loadY: 10 })),
        80,
        14,
        4,
      ),
    ).toEqual([]);
  });

  it("requires the complete label and padding to fit across sloping curves", () => {
    const points = [
      { x: 0, supplyY: 80, loadY: 80 },
      { x: 100, supplyY: 0, loadY: 80 },
      { x: 200, supplyY: 80, loadY: 80 },
    ];
    expect(surplusLabels(points, 80, 14, 4)).toEqual([{ x: 100, y: 57.6 }]);
    expect(surplusLabels(points, 160, 14, 4)).toEqual([]);
    expect(surplusLabels(points, 80, 70, 4)).toEqual([]);
  });

  it("uses interpolated crossings and keeps separated regions separate", () => {
    const points = [
      { x: 0, supplyY: 100, loadY: 80 },
      { x: 100, supplyY: 0, loadY: 80 },
      { x: 200, supplyY: 100, loadY: 80 },
      { x: 300, supplyY: 0, loadY: 80 },
      { x: 400, supplyY: 100, loadY: 80 },
    ];
    const labels = surplusLabels(points, 60, 14, 4);
    expect(labels).toHaveLength(2);
    expect(labels.map(({ x }) => x)).toEqual([100, 300]);
    expect(labels.every(({ y }) => y > 0 && y < 80)).toBe(true);
  });

  it("suppresses narrow gaps and labels that grow beyond the available space", () => {
    const points = [
      { x: 0, supplyY: 20, loadY: 80 },
      { x: 100, supplyY: 20, loadY: 80 },
    ];
    expect(surplusLabels(points, 80, 14, 4)).toHaveLength(1);
    expect(surplusLabels(points, 100, 14, 4)).toEqual([]);
    expect(surplusLabels(points, 80, 56, 4)).toEqual([]);
  });

  it("keeps label rectangles clear of source boundaries within the surplus", () => {
    const points = [0, 100, 200].map((x) => ({
      x,
      supplyY: 0,
      loadY: 100,
      boundariesY: [40],
    }));
    expect(surplusLabels(points, 80, 14, 4)).toEqual([{ x: 100, y: 70 }]);
    expect(
      surplusLabels(
        points.map((point) => ({
          ...point,
          boundariesY: [15, 30, 45, 60, 75, 90],
        })),
        80,
        14,
        4,
      ),
    ).toEqual([]);
  });
});

describe("source fill clipping", () => {
  const originalPath = globalThis.Path2D;
  class Polygon {
    vertices: Array<[number, number]> = [];
    moveTo(x: number, y: number) {
      this.vertices.push([x, y]);
    }
    lineTo(x: number, y: number) {
      this.vertices.push([x, y]);
    }
    closePath() {}
    contains(x: number, y: number) {
      let inside = false;
      for (
        let i = 0, j = this.vertices.length - 1;
        i < this.vertices.length;
        j = i++
      ) {
        const [ax, ay] = this.vertices[i];
        const [bx, by] = this.vertices[j];
        const aboveA = ay > y;
        const aboveB = by > y;
        if (aboveA !== aboveB && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
          inside = !inside;
      }
      return inside;
    }
  }
  let plot: Omit<uPlot, "data"> & { data: uPlot.AlignedData };
  let helper: ReturnType<typeof productionChartSurplus>;
  const draw = () => {
    const hook = helper.plugin.hooks.draw;
    hook(plot);
  };
  beforeEach(() => {
    globalThis.Path2D = Polygon as unknown as typeof Path2D;
    plot = {
      data: [
        [0, 100, 200],
        [200, 200, 200],
        [800, 800, 800],
        [300, 300, 300],
        [400, 500, 400],
        [500, 600, 500],
      ],
      bbox: { left: 0, top: 0, width: 200, height: 1000 },
      scales: { x: { min: 0, max: 200 }, y: { min: 0, max: 1000 } },
      valToPos: (value: number, axis: string) =>
        axis === "x" ? value : 1000 - value,
      ctx: {
        save: jest.fn(),
        restore: jest.fn(),
        fillText: jest.fn(),
        measureText: jest.fn(() => ({
          width: 80,
          actualBoundingBoxAscent: 10,
          actualBoundingBoxDescent: 4,
        })),
      },
    } as unknown as typeof plot;
    helper = productionChartSurplus(2, 5);
  });
  afterEach(() => {
    globalThis.Path2D = originalPath;
  });

  it("clips fills above complete load, retaining production below charging and exports", () => {
    const stroke = {} as Path2D;
    const fill = {} as Path2D;
    const native = jest.fn(() => ({ stroke, fill, clip: null }));
    const paths = helper.paths(native)(plot, 1, 0, 2)!;
    expect(paths.clip).not.toBeNull();
    const clip = paths.clip as unknown as Polygon;
    // At x=50, load interpolates to 550: demand=300, charging=150, exports=100.
    expect(clip.contains(50, 1000 - 600)).toBe(false);
    expect(clip.contains(50, 1000 - 500)).toBe(true);
    expect(clip.contains(50, 1000 - 250)).toBe(true);
    expect(paths.stroke).toBe(stroke);
    expect(paths.fill).toBe(fill);
    expect(native).toHaveBeenCalledWith(plot, 1, 0, 2);
  });

  it("uses full load for renewable-only supply as well as a dispatchable stack", () => {
    plot.data[1] = [800, 800, 800];
    helper = productionChartSurplus(1, 5);
    const paths = helper.paths(() => ({
      stroke: null,
      fill: null,
      clip: null,
    }))(plot, 1, 0, 2)!;
    expect((paths.clip as unknown as Polygon).contains(50, 1000 - 600)).toBe(
      false,
    );
    draw();
    expect(plot.ctx.fillText).toHaveBeenCalledWith("Unused surplus", 44, 306);
  });

  it("reuses geometry on annotation redraws and rebuilds it when data or scales change", () => {
    const paths = helper.paths(() => ({
      stroke: null,
      fill: null,
      clip: null,
    }));
    const first = paths(plot, 1, 0, 2)!.clip;
    draw();
    expect(paths(plot, 2, 0, 2)!.clip).toBe(first);
    expect(plot.ctx.measureText).toHaveBeenCalledTimes(1);
    plot.data = [plot.data[0], ...plot.data.slice(1, 5), [700, 700, 700]];
    const second = paths(plot, 1, 0, 2)!.clip;
    expect(second).not.toBe(first);
    expect((second as unknown as Polygon).contains(50, 1000 - 600)).toBe(true);
    plot.bbox.width = 300;
    expect(paths(plot, 1, 0, 2)!.clip).not.toBe(second);
  });

  it("omits labels when supply meets or falls below total load", () => {
    plot.data[2] = [500, 500, 500];
    draw();
    expect(plot.ctx.fillText).not.toHaveBeenCalled();
  });

  it("handles a day with no supply sources", () => {
    helper = productionChartSurplus(0, 5);
    draw();
    expect(plot.ctx.fillText).not.toHaveBeenCalled();
    expect(surplusLabels([], 80, 14, 4)).toEqual([]);
  });
});
