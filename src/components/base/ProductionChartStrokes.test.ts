import uPlot from "uplot";
import { SpeedType } from "../../Types";
import { productionChartStrokes } from "./ProductionChartStrokes";

describe("daily production curve cache", () => {
  let minute: number;
  let speed: SpeedType;
  let plot: Omit<uPlot, "data"> & { data: uPlot.AlignedData };
  let cache: ReturnType<typeof productionChartStrokes>;
  let contexts: Map<HTMLCanvasElement, CanvasRenderingContext2D>;
  let refresh: jest.Mock;
  let blackouts: Array<[number, number]>;
  const domain: [number, number] = [0, 50];
  const range: [number, number] = [0, 60];
  const originalPath = globalThis.Path2D;
  const state = () => ({
    minute,
    speed,
    domain,
    range,
    blackoutSpans: blackouts,
  });
  function hook(name: "init" | "draw" | "destroy") {
    const callbacks = cache.plugin.hooks![name];
    if (typeof callbacks === "function")
      callbacks(plot, {} as uPlot.Options, plot.data);
    else
      callbacks?.forEach((callback) =>
        callback?.(plot, {} as uPlot.Options, plot.data),
      );
  }
  async function draw() {
    hook("draw");
    await Promise.resolve();
  }
  const rasterCount = () =>
    [...contexts.values()].reduce(
      (sum, ctx) => sum + jest.mocked(ctx.stroke).mock.calls.length,
      0,
    );
  const masks = (first = 20): uPlot.AlignedData => [
    plot.data[0],
    [first, 30, null, null, null],
    [null, 30, 25, 40, 20],
  ];
  beforeEach(async () => {
    minute = 0;
    speed = "SLOW";
    domain[1] = 50;
    range[0] = 0;
    range[1] = 60;
    blackouts = [];
    contexts = new Map();
    refresh = jest.fn();
    globalThis.Path2D = jest.fn(() => ({
      moveTo: jest.fn(),
      lineTo: jest.fn(),
    })) as unknown as typeof Path2D;
    jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(function (this: HTMLCanvasElement) {
        if (!contexts.has(this))
          contexts.set(this, {
            canvas: this,
            save: jest.fn(),
            restore: jest.fn(),
            setTransform: jest.fn(),
            clearRect: jest.fn(),
            drawImage: jest.fn(),
            stroke: jest.fn(),
            setLineDash: jest.fn(),
          } as unknown as CanvasRenderingContext2D);
        return contexts.get(this)!;
      });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 80;
    plot = {
      ctx: canvas.getContext("2d")!,
      bbox: { left: 0, top: 20, width: 60, height: 40 },
      scales: { x: { min: 0, max: 60 }, y: { min: 0, max: 50 } },
      data: [
        [0, 15, 30, 45, 60],
        [20, 30, 25, null, null],
        [null, 30, 25, 40, 20],
      ],
      valToPos: (value: number, scale: string) =>
        scale === "x" ? value - range[0] : value,
      setData: jest.fn(),
      setCursor: jest.fn(),
      cursor: { idx: null, left: -10, top: -10 },
    } as unknown as typeof plot;
    cache = productionChartStrokes(
      state,
      [{ pastIndex: 1, color: "black", width: 2, dash: [2, 3] }],
      refresh,
    );
    hook("init");
    await draw();
  });
  afterEach(() => {
    hook("destroy");
    globalThis.Path2D = originalPath;
    jest.restoreAllMocks();
  });

  it("retains identical curve pixels, paints only the classification strip and refreshes the guide at a tick", () => {
    const original = plot.data;
    jest.mocked(plot.ctx.clearRect).mockClear();
    minute = 15;
    cache.updateData(plot, masks());
    expect(plot.setData).not.toHaveBeenCalled();
    expect(plot.data).toBe(original);
    expect(refresh).toHaveBeenCalledWith(plot);
    expect(plot.ctx.clearRect).toHaveBeenCalledWith(0, 20, 17, 40);
    expect(rasterCount()).toBe(2);
  });
  it("retains subpixel edits but flushes accumulated changes across a device pixel", () => {
    minute = 15;
    cache.updateData(plot, masks(20.4));
    expect(plot.setData).not.toHaveBeenCalled();
    minute = 30;
    const changed = masks(20.6);
    cache.updateData(plot, changed);
    expect(plot.setData).toHaveBeenCalledWith(changed);
  });
  it("flushes timestamp and gap changes", () => {
    minute = 15;
    const retimed: uPlot.AlignedData = [
      [0, 10, 30, 45, 60],
      ...masks().slice(1),
    ];
    cache.updateData(plot, retimed);
    expect(plot.setData).toHaveBeenCalledWith(retimed);
    jest.mocked(plot.setData).mockClear();
    const gap: uPlot.AlignedData = [
      plot.data[0],
      [20, 30, null, null, null],
      [null, 30, null, 40, 20],
    ];
    cache.updateData(plot, gap);
    expect(plot.setData).toHaveBeenCalledWith(gap);
  });
  it("flushes domain, range and blackout changes even with identical line values", () => {
    minute = 15;
    const data = masks();
    domain[1] = 100;
    cache.updateData(plot, data);
    expect(plot.setData).toHaveBeenLastCalledWith(data);
    domain[1] = 50;
    blackouts = [[20, 40]];
    jest.mocked(plot.setData).mockClear();
    cache.updateData(plot, data);
    expect(plot.setData).toHaveBeenCalledWith(data);
    blackouts = [];
    range[1] = 120;
    jest.mocked(plot.setData).mockClear();
    cache.updateData(plot, data);
    expect(plot.setData).toHaveBeenCalledWith(data);
  });
  it("checks filled allocations even when their divider is absent", async () => {
    hook("destroy");
    plot.data = [
      plot.data[0],
      [10, 20, 30, 40, 50],
      plot.data[1],
      plot.data[2],
    ];
    cache = productionChartStrokes(
      state,
      [{ pastIndex: 2, color: "black", width: 2, dash: [2, 3] }],
      refresh,
    );
    hook("init");
    await draw();
    minute = 15;
    const changed: uPlot.AlignedData = [
      plot.data[0],
      [11, 20, 30, 40, 50],
      plot.data[2],
      plot.data[3],
    ];
    cache.updateData(plot, changed);
    expect(plot.setData).toHaveBeenCalledWith(changed);
  });
  it("reuses stroke bitmaps on annotation redraws and rebuilds for values or scales", async () => {
    await draw();
    expect(rasterCount()).toBe(2);
    plot.data = [plot.data[0], [20, 35, 25, null, null], plot.data[2]];
    await draw();
    expect(rasterCount()).toBe(4);
    plot.scales.y.max = 100;
    await draw();
    expect(rasterCount()).toBe(6);
  });
  it("refreshes a stationary visible tooltip while retaining pixel-identical data", () => {
    plot.cursor.idx = 0;
    plot.cursor.left = plot.cursor.top = 0;
    minute = 15;
    cache.updateData(plot, masks(20.4));
    expect(plot.setData).not.toHaveBeenCalled();
    expect(plot.setCursor).toHaveBeenCalledWith({ left: 0, top: 0 });
  });
  it("uses native paths/data for pause, faster speeds, edits and skipped ticks", () => {
    const fallback = jest.fn();
    const paths = cache.paths(fallback);
    paths(plot, 1, 0, 4);
    expect(fallback).not.toHaveBeenCalled();
    for (const next of ["PAUSED", "NORMAL", "FAST", "ULTRA"] as const) {
      speed = next;
      cache.updateData(plot, plot.data);
      paths(plot, 1, 0, 4);
    }
    expect(plot.setData).toHaveBeenCalledTimes(4);
    expect(fallback).toHaveBeenCalledTimes(4);
    speed = "SLOW";
    for (const next of [0, 30]) {
      minute = next;
      cache.updateData(plot, plot.data);
    }
    expect(plot.setData).toHaveBeenCalledTimes(6);
  });
  it("discards queued backdrop work after destruction", async () => {
    hook("draw");
    const calls = jest.mocked(plot.ctx.drawImage).mock.calls.length;
    hook("destroy");
    await Promise.resolve();
    expect(plot.ctx.drawImage).toHaveBeenCalledTimes(calls);
  });
});
