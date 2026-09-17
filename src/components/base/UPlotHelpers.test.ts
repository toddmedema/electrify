import uPlot from "uplot";
import { eventMarkersPlugin } from "./UPlotHelpers";

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
