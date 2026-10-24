import { act, fireEvent, render, screen } from "@testing-library/react";
import uPlot from "uplot";
import UPlotChart from "./UPlotChart";
import { ChartViewportContext } from "./ChartViewportContext";
import { ChartAxisAlignment } from "./ChartAxisAlignment";
import { setThemeMode } from "../../Theme";
import { applyTextSize } from "../../TextSize";
import TutorialHud from "./TutorialHud";

jest.mock("uplot", () => {
  const MockUPlot = jest.fn();
  MockUPlot.prototype.cursor = {};
  MockUPlot.prototype.setData = jest.fn();
  MockUPlot.prototype.setSize = jest.fn();
  MockUPlot.prototype.setScale = jest.fn();
  MockUPlot.prototype.redraw = jest.fn();
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
      prototype: {
        over: HTMLDivElement;
        setSize: jest.Mock;
        setScale: jest.Mock;
        destroy: jest.Mock;
        redraw: jest.Mock;
      };
    }
  ).prototype;
  let width = 400;
  let resize: ResizeObserverCallback;
  const currentPlot = () =>
    (uPlot as unknown as jest.Mock).mock.results.at(-1)?.value;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (uPlot as unknown as jest.Mock).mockImplementation(() =>
      Object.assign(Object.create(uPlotPrototype), {
        over: document.createElement("div"),
      }),
    );
    width = 400;
    setThemeMode("light");
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
    act(() => applyTextSize("standard"));
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("rebuilds a mounted canvas when text size changes without a window resize", () => {
    render(
      <UPlotChart
        ariaLabel="Text size chart"
        state={{}}
        data={[
          [0, 1],
          [2, 3],
        ]}
        buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
      />,
    );
    expect(uPlot).toHaveBeenCalledTimes(1);
    act(() => applyTextSize("larger"));
    expect(uPlotPrototype.destroy).toHaveBeenCalledTimes(1);
    expect(uPlot).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("img", { name: /Text size chart/ })).toBeVisible();
  });

  it("aligns measured left axes including titles and shrinks when the widest chart is removed", () => {
    const chart = (name: string, size: number, label?: string) => (
      <UPlotChart
        key={name}
        ariaLabel={name}
        state={{}}
        data={[
          [0, 1],
          [2, 3],
        ]}
        buildOptions={() => ({
          width: 0,
          height: 0,
          series: [{}, {}],
          axes: [{ side: 3, size: () => size, label, labelSize: 16 }],
        })}
      />
    );
    const narrow = chart("Narrow", 20, "Units");
    const view = render(
      <ChartAxisAlignment>
        {chart("Wide", 60)}
        {narrow}
      </ChartAxisAlignment>,
    );
    const axes = (uPlot as unknown as jest.Mock).mock.calls.map(
      ([options]: [uPlot.Options]) => options.axes![0],
    );
    const gutter = (axis: uPlot.Axis) => {
      const size = axis.size;
      return (
        (typeof size === "function" ? size({} as uPlot, [], 0, 0) : size!) +
        (axis.label ? axis.labelSize! : 0)
      );
    };
    gutter(axes[0]);
    gutter(axes[1]);
    act(() => jest.advanceTimersByTime(20));
    expect(gutter(axes[0])).toBe(60);
    expect(gutter(axes[1])).toBe(60);
    expect(uPlotPrototype.redraw).toHaveBeenCalled();
    view.rerender(<ChartAxisAlignment>{narrow}</ChartAxisAlignment>);
    act(() => jest.advanceTimersByTime(20));
    expect(gutter(axes[1])).toBe(36);
  });

  function renderInteractiveChart() {
    render(
      <UPlotChart
        ariaLabel="Demand chart"
        state={{}}
        interactiveTooltip
        tooltip={(index) => `Point ${index}`}
        data={[
          [0, 1],
          [2, 3],
        ]}
        buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
      />,
    );
    const plot = currentPlot();
    plot.cursor = { left: -10, idx: null };
    plot.valToPos = jest.fn((value: number) => value);
    plot.setCursor = jest.fn((position: { left: number; top: number }) => {
      plot.cursor = {
        ...position,
        idx: position.left < 0 ? null : position.left,
      };
    });
    return { chart: screen.getByRole("img", { name: /Demand chart/ }) };
  }

  it("uses Escape for an open chart tooltip, then lets Back leave the chart", () => {
    const { chart } = renderInteractiveChart();
    expect(fireEvent.keyDown(chart, { key: "Escape" })).toBe(true);
    fireEvent.keyDown(chart, { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent("Point 0");
    expect(fireEvent.keyDown(chart, { key: "Escape" })).toBe(false);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(fireEvent.keyDown(chart, { key: "Escape" })).toBe(true);
  });

  it("keeps compatibility moves from dismissing keyboard selection and hands off to intentional pointer input", () => {
    const { chart } = renderInteractiveChart();
    const pointer = (type: string, x: number, pointerType = "mouse") => {
      const event = new Event(type, { bubbles: true });
      // Chromium mobile emulation can report zero movement deltas despite changed coordinates.
      Object.assign(event, {
        clientX: x,
        clientY: 20,
        pointerType,
        movementX: 0,
        movementY: 0,
      });
      fireEvent(chart, event);
    };
    pointer("pointerdown", 80, "touch");
    fireEvent.keyDown(chart, { key: "Home" });
    pointer("pointermove", 80);
    expect(screen.getByRole("status")).toHaveTextContent("Point 0");
    pointer("pointermove", 50);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    fireEvent.keyDown(chart, { key: "Home" });
    pointer("pointerdown", 80, "touch");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    fireEvent.keyDown(chart, { key: "Home" });
    fireEvent.blur(chart);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("continues a chart tutorial once when Confirm inspects a point", async () => {
    const next = jest.fn();
    render(
      <>
        <UPlotChart
          id="tutorial-chart"
          ariaLabel="Tutorial demand chart"
          state={{}}
          interactiveTooltip
          tooltip={(index) => `Point ${index}`}
          data={[
            [0, 1],
            [2, 3],
          ]}
          buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
        />
        <TutorialHud
          desktop
          step={{
            card: "FACILITIES",
            action: "Tap the chart",
            content: <p>Inspect demand</p>,
            continueOnClick: "#tutorial-chart",
          }}
          stepIndex={1}
          totalSteps={3}
          canGoBack
          onBack={jest.fn()}
          onExit={jest.fn()}
          onNext={next}
        />
      </>,
    );
    const plot = currentPlot();
    plot.valToPos = jest.fn((value: number) => value);
    plot.setCursor = jest.fn();
    const chart = screen.getByRole("img", { name: /Tutorial demand chart/ });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(next).not.toHaveBeenCalled();
    fireEvent.keyDown(chart, { key: "Enter" });
    await act(async () => jest.runAllTicks());
    expect(next).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Point 1");
    fireEvent.keyDown(chart, { key: "Enter" });
    await act(async () => jest.runAllTicks());
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("remeasures a plot when the bundled font finishes loading after its first draw", async () => {
    const previous = Object.getOwnPropertyDescriptor(document, "fonts");
    let finishLoading!: (fonts: FontFace[]) => void;
    const loaded = new Promise<FontFace[]>((resolve) => {
      finishLoading = resolve;
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { check: () => false, load: () => loaded },
    });
    try {
      render(
        <UPlotChart
          ariaLabel="Delayed font chart"
          state={{}}
          data={[
            [0, 1],
            [2, 3],
          ]}
          buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
        />,
      );
      expect(uPlot).toHaveBeenCalledTimes(1);
      await act(async () => {
        finishLoading([]);
        await loaded;
      });
      expect(uPlotPrototype.destroy).toHaveBeenCalledTimes(1);
      expect(uPlot).toHaveBeenCalledTimes(2);
    } finally {
      if (previous) Object.defineProperty(document, "fonts", previous);
      else Reflect.deleteProperty(document, "fonts");
    }
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

  it("applies a shared viewport and reserves Ctrl-wheel for anchored zoom", () => {
    const onRangeChange = jest.fn();
    render(
      <ChartViewportContext.Provider
        value={{
          bounds: [0, 100],
          range: [0, 100],
          minSpan: 10,
          onRangeChange,
          onReset: jest.fn(),
        }}
      >
        <UPlotChart
          ariaLabel="Interactive chart"
          state={{}}
          data={[
            [0, 100],
            [2, 3],
          ]}
          buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
        />
      </ChartViewportContext.Provider>,
    );

    expect(uPlotPrototype.setScale).toHaveBeenCalledWith("x", {
      min: 0,
      max: 100,
    });
    const ordinaryWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
    });
    currentPlot().over.dispatchEvent(ordinaryWheel);
    expect(ordinaryWheel.defaultPrevented).toBe(false);

    const zoomWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      clientX: 200,
      deltaY: -120,
    });
    act(() => {
      currentPlot().over.dispatchEvent(zoomWheel);
      jest.advanceTimersByTime(200);
    });
    expect(zoomWheel.defaultPrevented).toBe(true);
    expect(onRangeChange).toHaveBeenCalled();
    const zoomed = onRangeChange.mock.calls.at(-1)?.[0];
    expect(zoomed[1] - zoomed[0]).toBeLessThan(100);
  });

  it("pans with a pointer drag and zooms with a touch pinch", () => {
    const onRangeChange = jest.fn();
    const pointer = (type: string, values: Record<string, string | number>) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, values);
      currentPlot().over.dispatchEvent(event);
    };
    render(
      <ChartViewportContext.Provider
        value={{
          bounds: [0, 100],
          range: [25, 75],
          minSpan: 10,
          onRangeChange,
          onReset: jest.fn(),
        }}
      >
        <UPlotChart
          ariaLabel="Gesture chart"
          state={{}}
          data={[
            [0, 100],
            [2, 3],
          ]}
          buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
        />
      </ChartViewportContext.Provider>,
    );

    pointer("pointerdown", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 100,
      clientY: 10,
    });
    pointer("pointermove", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 80,
      clientY: 10,
    });
    pointer("pointerup", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 80,
      clientY: 10,
    });
    expect(onRangeChange).toHaveBeenCalled();
    expect(onRangeChange.mock.calls.at(-1)?.[0]).toEqual([50, 100]);

    onRangeChange.mockClear();
    pointer("pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      button: 0,
      clientX: 100,
      clientY: 10,
    });
    pointer("pointerdown", {
      pointerId: 3,
      pointerType: "touch",
      button: 0,
      clientX: 200,
      clientY: 10,
    });
    pointer("pointermove", {
      pointerId: 3,
      pointerType: "touch",
      clientX: 250,
      clientY: 10,
    });
    pointer("pointerup", {
      pointerId: 3,
      pointerType: "touch",
      clientX: 250,
      clientY: 10,
    });
    const pinched = onRangeChange.mock.calls.at(-1)?.[0];
    expect(pinched[1] - pinched[0]).toBeLessThan(50);
  });

  it.each(["theme", "structure", "height"])(
    "restores the viewport and gestures after a %s rebuild",
    (change) => {
      const onRangeChange = jest.fn();
      const onReset = jest.fn();
      const viewport = {
        bounds: [0, 100] as [number, number],
        range: [25, 75] as [number, number],
        minSpan: 10,
        onRangeChange,
        onReset,
      };
      const ui = (changed = false) => (
        <ChartViewportContext.Provider value={viewport}>
          <UPlotChart
            ariaLabel="Rebuilt chart"
            state={{}}
            data={[
              [0, 100],
              [2, 3],
            ]}
            height={changed && change === "height" ? 400 : 300}
            structureKey={
              changed && change === "structure" ? "changed" : "initial"
            }
            buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
          />
        </ChartViewportContext.Provider>
      );
      const view = render(ui());
      const oldOver = currentPlot().over;
      uPlotPrototype.setScale.mockClear();
      if (change === "theme") act(() => setThemeMode("dark"));
      else view.rerender(ui(true));
      const over = currentPlot().over;
      expect(over).not.toBe(oldOver);
      expect(uPlotPrototype.setScale).toHaveBeenCalledWith("x", {
        min: 25,
        max: 75,
      });
      const wheel = () =>
        new WheelEvent("wheel", {
          ctrlKey: true,
          deltaY: -120,
          clientX: 200,
          cancelable: true,
        });
      act(() => {
        oldOver.dispatchEvent(wheel());
        jest.advanceTimersByTime(200);
      });
      expect(onRangeChange).not.toHaveBeenCalled();
      act(() => {
        over.dispatchEvent(wheel());
        jest.advanceTimersByTime(200);
      });
      const zoomed = onRangeChange.mock.calls.at(-1)?.[0];
      expect(zoomed[1] - zoomed[0]).toBeLessThan(50);
      onRangeChange.mockClear();
      act(() => {
        for (const [type, clientX] of [
          ["pointerdown", 100],
          ["pointermove", 80],
          ["pointerup", 80],
        ] as const) {
          const event = new Event(type, { cancelable: true });
          Object.assign(event, {
            pointerId: 1,
            pointerType: "mouse",
            button: 0,
            clientX,
            clientY: 10,
          });
          over.dispatchEvent(event);
        }
      });
      expect(onRangeChange).toHaveBeenLastCalledWith([50, 100], true);
      over.dispatchEvent(new MouseEvent("dblclick", { cancelable: true }));
      expect(onReset).toHaveBeenCalledWith(true);
    },
  );
});
