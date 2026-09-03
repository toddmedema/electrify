import { act, render } from "@testing-library/react";
import uPlot from "uplot";
import UPlotChart from "./UPlotChart";

jest.mock("uplot", () => {
  const MockUPlot = jest.fn();
  MockUPlot.prototype.over = global.document.createElement("div");
  MockUPlot.prototype.cursor = {};
  MockUPlot.prototype.setData = jest.fn();
  MockUPlot.prototype.setSize = jest.fn();
  MockUPlot.prototype.destroy = jest.fn();
  return { __esModule: true, default: MockUPlot };
});

jest.mock("./UPlotHelpers", () => ({
  chartScale: (width: number) => Math.min(width / 350, 1.4),
  eventMarkersPlugin: () => ({ hooks: {} }),
}));

describe("UPlotChart resizing", () => {
  const uPlotPrototype = (
    uPlot as unknown as {
      prototype: { setSize: jest.Mock; destroy: jest.Mock };
    }
  ).prototype;
  let width = 400;
  let resize: ResizeObserverCallback;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    width = 400;
    jest.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          width,
          height: 200,
          top: 0,
          right: width,
          bottom: 200,
          left: 0,
          x: 0,
          y: 0,
          toJSON: () => undefined,
        }) as DOMRect,
    );
    window.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      public observe() {
        return undefined;
      }
      public unobserve() {
        return undefined;
      }
      public disconnect() {
        return undefined;
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("resizes the live canvas and rebuilds scaled options only after resizing settles", () => {
    render(
      <UPlotChart
        ariaLabel="Test chart"
        state={{}}
        data={[
          [0, 1],
          [2, 3],
        ]}
        buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
      />,
    );

    expect(uPlot).toHaveBeenCalledTimes(1);

    const resizeTo = (nextWidth: number) => {
      width = nextWidth;
      act(() => {
        resize([], {} as ResizeObserver);
        jest.advanceTimersByTime(16);
      });
    };
    resizeTo(440);
    resizeTo(480);
    resizeTo(520);

    expect(uPlotPrototype.setSize).toHaveBeenCalledTimes(3);
    expect(uPlotPrototype.setSize).toHaveBeenLastCalledWith({
      width: 520,
      height: 420,
    });
    expect(uPlot).toHaveBeenCalledTimes(1);

    act(() => jest.advanceTimersByTime(103));
    expect(uPlot).toHaveBeenCalledTimes(1);

    act(() => jest.advanceTimersByTime(1));
    expect(uPlotPrototype.destroy).toHaveBeenCalledTimes(1);
    expect(uPlot).toHaveBeenCalledTimes(2);
  });
});
