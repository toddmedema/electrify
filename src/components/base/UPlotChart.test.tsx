import {
  resetInputPresentation,
  updateInputPresentation,
} from "../../desktop/InputPresentation";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import uPlot from "uplot";
import UPlotChart, { BuildContext } from "./UPlotChart";
import { ChartPresentationContext } from "./ChartPresentationContext";
import { ChartViewportContext } from "./ChartViewportContext";
import { ChartAxisAlignment } from "./ChartAxisAlignment";
import { setThemeMode } from "../../Theme";
import { applyInterfaceScale } from "../../InterfaceScale";
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
  expandedChartOptions: (options: uPlot.Options) => options,
  eventMarkersPlugin: () => ({ hooks: {} }),
  hoverPoints: () => ({}),
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
    resetInputPresentation();
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
    act(() => {
      resetInputPresentation();
      applyInterfaceScale(1);
    });
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("never announces negative zero in a chart summary", () => {
    const props = {
      ariaLabel: "Zero chart",
      state: {},
      data: [
        [0, 1],
        [-0, -0.001],
      ] as uPlot.AlignedData,
      buildOptions: () => ({ width: 0, height: 0, series: [{}, {}] }),
    };
    const view = render(<UPlotChart {...props} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /latest -0\.001, range -0\.001 to 0/,
    );
    view.rerender(
      <UPlotChart
        {...props}
        formatSummaryValue={(value) => value.toFixed(1)}
      />,
    );
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /latest 0\.0, range 0\.0 to 0\.0/,
    );
  });

  it("feeds a chart-owned updater fresh data while accessible values remain current, and restores default updates after rebuild", () => {
    const update = jest.fn();
    const custom = ({
      registerDataUpdate,
    }: BuildContext<object>): uPlot.Options => {
      registerDataUpdate?.(update);
      return { width: 0, height: 0, series: [{}, {}] };
    };
    const data = (value: number): uPlot.AlignedData => [
      [0, 1],
      [value, value],
    ];
    const ui = (values: uPlot.AlignedData, owned = true) => (
      <UPlotChart
        ariaLabel="Live reading"
        state={{}}
        data={values}
        structureKey={owned ? "owned" : "default"}
        buildOptions={
          owned ? custom : () => ({ width: 0, height: 0, series: [{}, {}] })
        }
      />
    );
    const view = render(ui(data(1)));
    const next = data(1.4);
    view.rerender(ui(next));
    expect(update).toHaveBeenCalledWith(currentPlot(), next);
    expect(currentPlot().setData).not.toHaveBeenCalled();
    expect(
      screen.getByRole("img", { name: /Live reading.*latest 1\.4/ }),
    ).toBeVisible();
    view.rerender(ui(data(3), false));
    const latest = data(4);
    view.rerender(ui(latest, false));
    expect(currentPlot().setData).toHaveBeenCalledWith(latest);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("refreshes the visible tooltip through setCursor after a retained numeric edit without pointer movement", () => {
    const options = ({
      registerDataUpdate,
    }: BuildContext<{ value: number }>): uPlot.Options => {
      registerDataUpdate?.((plot) => {
        plot.setCursor({ left: plot.cursor.left!, top: plot.cursor.top! });
      });
      return { width: 0, height: 0, series: [{}, {}] };
    };
    const ui = (value: number) => (
      <UPlotChart
        ariaLabel="Inspected output"
        state={{ value }}
        data={[
          [0, 1],
          [value, value],
        ]}
        buildOptions={options}
        tooltip={(_index, state) => `Output ${state.value}`}
      />
    );
    const view = render(ui(1));
    const plot = currentPlot();
    const built = (uPlot as unknown as jest.Mock).mock.calls.at(
      -1,
    )[0] as uPlot.Options;
    const tooltip = built.plugins!.at(-1)!;
    const init = tooltip.hooks!.init;
    screen
      .getByRole("img", { name: /Inspected output/ })
      .appendChild(plot.over);
    if (typeof init === "function")
      init(plot, built, [
        [0, 1],
        [1, 1],
      ]);
    plot.cursor = { idx: 0, left: 0, top: 0 };
    plot.setCursor = jest.fn((position: { left: number; top: number }) => {
      plot.cursor = { ...position, idx: 0 };
      const cursor = tooltip.hooks!.setCursor;
      if (typeof cursor === "function") cursor(plot);
    });
    plot.setCursor({ left: 0, top: 0 });
    expect(screen.getByText("Output 1", { exact: true })).toBeVisible();
    view.rerender(ui(1.4));
    expect(plot.setData).not.toHaveBeenCalled();
    expect(plot.cursor).toEqual({ idx: 0, left: 0, top: 0 });
    expect(screen.getByText("Output 1.4", { exact: true })).toBeVisible();
  });

  it("keeps solar context visible after the supply and load breakdown", () => {
    render(
      <UPlotChart
        ariaLabel="Daylight chart"
        state={{}}
        data={[
          [0, 1],
          [10, 10],
        ]}
        buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
        interactiveTooltip
        tooltip={() =>
          "12 AM\nTotal supply: 10W\nWind: 10W\n\nTotal load: 9W\nDemand: 9W\n\nSunrise: 6:05 AM\nSunset: 6:07 PM"
        }
      />,
    );
    const plot = currentPlot();
    const built = (uPlot as unknown as jest.Mock).mock.calls.at(
      -1,
    )[0] as uPlot.Options;
    const tooltip = built.plugins!.at(-1)!;
    screen.getByRole("img", { name: /Daylight chart/ }).appendChild(plot.over);
    const init = tooltip.hooks!.init;
    if (typeof init === "function")
      init(plot, built, [
        [0, 1],
        [10, 10],
      ]);
    plot.cursor = { idx: 0, left: 0, top: 0 };
    const cursor = tooltip.hooks!.setCursor;
    if (typeof cursor === "function") cursor(plot);
    expect(screen.getByText("Total supply: 10W")).toBeVisible();
    expect(screen.getByText("Total load: 9W")).toBeVisible();
    expect(screen.getByText(/Sunrise: 6:05 AM/)).toHaveTextContent(
      "Sunset: 6:07 PM",
    );
    expect(screen.getByText(/Sunrise: 6:05 AM/)).toBeVisible();
  });

  const renderMouseTooltipChart = (syncKey?: string) => {
    render(
      <UPlotChart
        ariaLabel="Mouse inspection chart"
        state={{}}
        data={[
          [0, 1],
          [10, 10],
        ]}
        buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
        tooltip={() => "Inspected point"}
        syncKey={syncKey}
      />,
    );
    const plot = currentPlot();
    const built = (uPlot as unknown as jest.Mock).mock.calls.at(
      -1,
    )[0] as uPlot.Options;
    const plugin = built.plugins!.at(-1)!;
    screen
      .getByRole("img", { name: /Mouse inspection chart/ })
      .appendChild(plot.over);
    plot.setCursor = jest.fn((position: { left: number; top: number }) => {
      plot.cursor = { ...position, idx: 0 };
      const cursor = plugin.hooks!.setCursor;
      if (typeof cursor === "function") cursor(plot);
    });
    // uPlot installs its cursor listener before the plugin's init hook runs.
    plot.over.addEventListener("mousemove", () =>
      plot.setCursor({ left: 60, top: 40 }),
    );
    const init = plugin.hooks!.init;
    if (typeof init === "function") init(plot, built, [[], []]);
    plot.destroy = jest.fn(() => {
      const destroy = plugin.hooks!.destroy;
      if (typeof destroy === "function") destroy(plot);
    });
    fireEvent.mouseEnter(plot.over);
    plot.setCursor({ left: 20, top: 40 });
    const tip = screen.getByText("Inspected point");
    if (syncKey) fireEvent.mouseLeave(plot.over);
    return { plot, tip };
  };

  it.each(["a second plot contact", "a contact elsewhere on the page"])(
    "restores an ordinary mouse tooltip after multi-touch with %s",
    (source) => {
      const { plot, tip } = renderMouseTooltipChart();
      plot.setCursor({ left: 20, top: 40 });
      expect(tip).toBeVisible();
      const touches = [
        plot.over,
        source.includes("elsewhere") ? document.body : plot.over,
      ].map((target, identifier) => ({
        target,
        identifier,
        clientX: 40 + identifier * 40,
        clientY: 40,
      }));
      fireEvent.touchStart(plot.over, { touches, changedTouches: touches });
      expect(tip).not.toBeVisible();
      fireEvent.touchEnd(plot.over, { touches: [], changedTouches: touches });
      // The mouse can already be over the plot when touch inspection finishes.
      // A fresh move must restore details before uPlot updates its cursor.
      fireEvent.mouseMove(plot.over, { clientX: 60, clientY: 40 });
      expect(tip).toBeVisible();
      expect(tip).toHaveTextContent("Inspected point");
    },
  );

  it("keeps synchronized mouse tooltips local to the hovered chart", () => {
    const { plot, tip } = renderMouseTooltipChart("shared-inspection");
    plot.setCursor({ left: 20, top: 40 });
    expect(tip).not.toBeVisible();
    fireEvent.mouseEnter(plot.over);
    plot.setCursor({ left: 40, top: 40 });
    expect(tip).toBeVisible();
    fireEvent.mouseLeave(plot.over);
    plot.setCursor({ left: 60, top: 40 });
    expect(tip).not.toBeVisible();
  });

  it("restores synchronized tooltips from local mouse movement after multi-touch, without reopening from sync alone", () => {
    const { plot, tip } = renderMouseTooltipChart("shared-inspection");
    // This fixture leaves synchronized charts unhovered. Enter once before touch input,
    // then keep the mouse over the plot throughout the gesture and recovery.
    fireEvent.mouseEnter(plot.over);
    plot.setCursor({ left: 20, top: 40 });
    expect(tip).toBeVisible();
    const touches = [40, 80].map((clientX, identifier) => ({
      target: plot.over,
      identifier,
      clientX,
      clientY: 40,
    }));
    fireEvent.touchStart(plot.over, { touches, changedTouches: touches });
    expect(tip).not.toBeVisible();
    fireEvent.touchEnd(plot.over, { touches: [], changedTouches: touches });
    // A synchronized cursor update is not local mouse input and must stay hidden.
    plot.setCursor({ left: 40, top: 40 });
    expect(tip).not.toBeVisible();
    fireEvent.mouseMove(plot.over, { clientX: 60, clientY: 40 });
    expect(tip).toBeVisible();
    fireEvent.mouseLeave(plot.over);
    plot.setCursor({ left: 80, top: 40 });
    expect(tip).not.toBeVisible();
  });

  it.each(["pointercancel", "touchcancel"])(
    "keeps breakdown details open when tooltip scrolling sends %s, but dismisses chart cancellation",
    (eventType) => {
      render(
        <UPlotChart
          ariaLabel="Scrollable breakdown"
          state={{}}
          data={[
            [0, 1],
            [10, 10],
          ]}
          buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
          interactiveTooltip
          tooltip={() =>
            "12 AM\nTotal supply: 10W\nWind: 10W\n\nTotal load: 9W\nDemand: 9W"
          }
        />,
      );
      const plot = currentPlot();
      const built = (uPlot as unknown as jest.Mock).mock.calls.at(
        -1,
      )[0] as uPlot.Options;
      const plugin = built.plugins!.at(-1)!;
      screen
        .getByRole("img", { name: /Scrollable breakdown/ })
        .appendChild(plot.over);
      const init = plugin.hooks!.init;
      if (typeof init === "function")
        init(plot, built, [
          [0, 1],
          [10, 10],
        ]);
      plot.setCursor = jest.fn((position: { left: number; top: number }) => {
        plot.cursor = { ...position, idx: position.left < 0 ? null : 0 };
        const cursor = plugin.hooks!.setCursor;
        if (typeof cursor === "function") cursor(plot);
      });
      const touch = { identifier: 1, clientX: 80, clientY: 80 };
      fireEvent.touchStart(plot.over, { touches: [touch] });
      fireEvent.touchEnd(plot.over, { touches: [] });
      const details = screen.getByText("Total supply: 10W");
      expect(details).toBeVisible();
      fireEvent.touchStart(details, { touches: [touch] });
      fireEvent(details, new Event(eventType, { bubbles: true }));
      expect(details).toBeVisible();
      fireEvent.touchEnd(details, { touches: [] });
      fireEvent.touchStart(plot.over, { touches: [touch] });
      fireEvent(plot.over, new Event(eventType, { bubbles: true }));
      expect(details).not.toBeVisible();
    },
  );

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
    act(() => applyInterfaceScale(1.25));
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

  it("uses the full chart when keyboard values exceed the plot and restores pointer inspection", () => {
    const { chart } = renderInteractiveChart();
    const plot = currentPlot();
    plot.root = document.createElement("div");
    plot.root.appendChild(plot.over);
    chart.appendChild(plot.root);
    Object.defineProperty(plot.root, "clientHeight", { value: 300 });
    Object.defineProperty(plot.over, "clientHeight", { value: 160 });
    const built = (uPlot as unknown as jest.Mock).mock.calls.at(
      -1,
    )[0] as uPlot.Options;
    const plugin = built.plugins!.at(-1)!;
    const init = plugin.hooks.init;
    if (typeof init === "function") init(plot, built, []);
    const values = within(chart).getByText(
      (_content, element) =>
        element?.classList.contains("chartTooltip") ?? false,
    );
    Object.defineProperty(values, "scrollHeight", { value: 220 });
    const moveCursor = plugin.hooks.setCursor;
    plot.setCursor = jest.fn((position: { left: number; top: number }) => {
      plot.cursor = { ...position, idx: 0 };
      if (typeof moveCursor === "function") moveCursor(plot);
    });
    fireEvent.keyDown(chart, { key: "Enter" });
    expect(values).toHaveTextContent("Point 0");
    expect(plot.root).toContainElement(values);
    expect(plot.over).not.toContainElement(values);
    expect(values).toHaveStyle({ maxHeight: "300px" });
    fireEvent.pointerDown(values);
    fireEvent.pointerMove(values);
    expect(screen.getByRole("status")).toHaveTextContent("Point 0");
    expect(plot.root).toContainElement(values);
    expect(plot.over).not.toContainElement(values);
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    fireEvent.pointerDown(chart);
    plot.setCursor({ left: 20, top: 20 });
    expect(plot.over).toContainElement(values);
    expect(values).toHaveStyle({ maxHeight: "160px" });
  });

  it("lets an ordinary chart hand keyboard inspection to a mouse over its tooltip", () => {
    const { chart } = renderInteractiveChart();
    const tooltip = document.createElement("div");
    tooltip.className = "chartTooltip";
    tooltip.textContent = "Visible chart details";
    chart.appendChild(tooltip);
    fireEvent.keyDown(chart, { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent("Point 0");
    const move = new Event("pointermove", { bubbles: true });
    Object.assign(move, { clientX: 20, clientY: 20, pointerType: "mouse" });
    fireEvent(screen.getByText("Visible chart details"), move);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
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

  it("reserves a readable chart when supporting chrome must scroll and stays stable across resizing and reopening", () => {
    applyInterfaceScale(2.5);
    const viewport = document.createElement("div");
    viewport.setAttribute("data-chart-viewport", "");
    let availableHeight = 360;
    Object.defineProperty(viewport, "clientHeight", {
      get: () => availableHeight,
    });
    const block = document.createElement("section");
    block.className = "insightsTrack";
    // The mocked plot has no DOM height; the real title/legend still occupy their own space.
    Object.defineProperty(block, "clientHeight", { value: 80 });
    viewport.appendChild(block);
    document.body.appendChild(viewport);
    const ui = (open: boolean) => (
      <details open={open} style={{ overflowY: "auto" }}>
        <summary>Forecast</summary>
        <UPlotChart
          ariaLabel="Allocated chart"
          height={300}
          state={{}}
          data={[
            [0, 1],
            [2, 3],
          ]}
          buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
        />
      </details>
    );
    const view = render(ui(true), { container: block });
    const initialOptions = (uPlot as unknown as jest.Mock).mock.calls.at(-1)[0];
    expect(initialOptions.height).toBe(320);
    const notifyResize = () =>
      act(() => {
        resize([], {} as ResizeObserver);
        jest.advanceTimersByTime(16);
      });
    availableHeight = 300;
    notifyResize();
    expect(uPlotPrototype.setSize).toHaveBeenLastCalledWith({
      width: 400,
      height: 260,
    });
    const calls = uPlotPrototype.setSize.mock.calls.length;
    notifyResize();
    notifyResize();
    expect(uPlotPrototype.setSize).toHaveBeenCalledTimes(calls);
    view.rerender(ui(false));
    availableHeight = 600;
    view.rerender(ui(true));
    notifyResize();
    expect(uPlotPrototype.setSize).toHaveBeenLastCalledWith({
      width: 400,
      height: 343,
    });
    view.unmount();
    viewport.remove();
  });

  it("preserves natural plot height inside intrinsically sized scrolling content", () => {
    const scroll = document.createElement("div");
    scroll.style.overflowY = "auto";
    Object.defineProperty(scroll, "clientHeight", { value: 180 });
    document.body.appendChild(scroll);
    const view = render(
      <UPlotChart
        ariaLabel="Natural chart"
        height={300}
        state={{}}
        data={[
          [0, 1],
          [2, 3],
        ]}
        buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
      />,
      { container: scroll },
    );
    expect((uPlot as unknown as jest.Mock).mock.calls.at(-1)[0].height).toBe(
      343,
    );
    act(() => {
      resize([], {} as ResizeObserver);
      jest.advanceTimersByTime(16);
      resize([], {} as ResizeObserver);
    });
    expect(uPlotPrototype.setSize).not.toHaveBeenCalled();
    view.unmount();
    scroll.remove();
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

  it("pans with a mouse drag", () => {
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
  });

  it.each([false, true])(
    "pans and pinches paired touches without scale drift (staggered: %s)",
    (staggered) => {
      const onRangeChange = jest.fn();
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
            ariaLabel="Touch chart"
            state={{}}
            data={[
              [0, 100],
              [2, 3],
            ]}
            buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
          />
        </ChartViewportContext.Provider>,
      );
      const touch = (type: string, positions: number[], y = 10) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        const touches = positions.map((clientX, identifier) => ({
          identifier,
          clientX,
          clientY: y,
          target: currentPlot().over,
        }));
        Object.assign(event, {
          touches,
          changedTouches: touches,
        });
        act(() => currentPlot().over.dispatchEvent(event));
        return event;
      };
      expect(touch("touchstart", [100]).defaultPrevented).toBe(false);
      if (!staggered) touch("touchend", []);
      expect(touch("touchstart", [100, 200]).defaultPrevented).toBe(true);
      expect(touch("touchmove", [140, 240], 40).defaultPrevented).toBe(true);
      act(() => jest.advanceTimersByTime(20));
      expect(onRangeChange).toHaveBeenLastCalledWith([20, 70]);

      // Browser pointer cancellation must not terminate the independently owned touch stream.
      const cancelled = new Event("pointercancel", { bubbles: true });
      Object.assign(cancelled, { pointerId: 1, pointerType: "touch" });
      currentPlot().over.dispatchEvent(cancelled);
      touch("touchmove", [80, 280], 60);
      touch(staggered ? "touchcancel" : "touchend", []);
      // The original value under the midpoint stays under the new midpoint while zooming.
      expect(onRangeChange).toHaveBeenLastCalledWith([32.5, 57.5], true);
      onRangeChange.mockClear();
      touch("touchmove", [150]);
      act(() => jest.advanceTimersByTime(20));
      expect(onRangeChange).not.toHaveBeenCalled();
    },
  );

  const viewportTouch = (
    target: HTMLElement,
    type: string,
    touches: Array<{
      identifier: number;
      clientX: number;
      clientY: number;
      target: EventTarget;
    }>,
    changedTouches = touches,
  ) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { touches, changedTouches });
    act(() => target.dispatchEvent(event));
    return event;
  };
  const renderTouchViewport = (name: string, onRangeChange: jest.Mock) => {
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
          ariaLabel={name}
          state={{}}
          data={[
            [0, 100],
            [2, 3],
          ]}
          buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
        />
      </ChartViewportContext.Provider>,
    );
    return { over: currentPlot().over as HTMLDivElement };
  };

  it.each(["neighboring chart", "unrelated control"])(
    "ignores a contact that started on a %s",
    (outside) => {
      const onRangeChange = jest.fn();
      const otherRangeChange = jest.fn();
      const { over } = renderTouchViewport("Owned chart", onRangeChange);
      const foreign =
        outside === "neighboring chart"
          ? renderTouchViewport("Other chart", otherRangeChange).over
          : document.createElement("button");
      const own = (x: number) => ({
        identifier: 0,
        clientX: x,
        clientY: 10,
        target: over,
      });
      const other = (x: number) => ({
        identifier: 1,
        clientX: x,
        clientY: 10,
        target: foreign,
      });

      viewportTouch(over, "touchstart", [own(100)]);
      viewportTouch(
        foreign,
        "touchstart",
        [own(100), other(200)],
        [other(200)],
      );
      viewportTouch(over, "touchmove", [own(140), other(240)], [own(140)]);
      // Touch.target remains the original element even when the other finger moves
      // over this plot. Global contacts must not become this chart's pinch pair.
      const move = viewportTouch(
        over,
        "touchmove",
        [own(160), other(360)],
        [own(160)],
      );
      act(() => jest.advanceTimersByTime(20));
      viewportTouch(over, "touchend", [other(360)], [own(160)]);
      viewportTouch(foreign, "touchend", [], [other(360)]);
      expect(onRangeChange).not.toHaveBeenCalled();
      expect(otherRangeChange).not.toHaveBeenCalled();
      expect(move.defaultPrevented).toBe(false);
    },
  );

  it.each(["touchend", "touchcancel"])(
    "does not replace an owned pinch contact with an unrelated contact after %s",
    (type) => {
      const onRangeChange = jest.fn();
      const { over } = renderTouchViewport("Owned chart", onRangeChange);
      const foreign = document.createElement("button");
      const own = (identifier: number, clientX: number) => ({
        identifier,
        clientX,
        clientY: 10,
        target: over,
      });
      const other = (clientX: number) => ({
        identifier: 99,
        clientX,
        clientY: 10,
        target: foreign,
      });

      viewportTouch(over, "touchstart", [own(0, 100), own(1, 200)]);
      viewportTouch(
        over,
        "touchmove",
        [other(320), own(0, 140), own(1, 240)],
        [own(0, 140), own(1, 240)],
      );
      act(() => jest.advanceTimersByTime(20));
      expect(onRangeChange).toHaveBeenLastCalledWith([20, 70]);
      viewportTouch(over, type, [other(320), own(0, 140)], [own(1, 240)]);
      expect(onRangeChange).toHaveBeenLastCalledWith([20, 70], true);
      onRangeChange.mockClear();
      viewportTouch(
        over,
        "touchmove",
        [other(340), own(0, 160)],
        [own(0, 160)],
      );
      const move = viewportTouch(
        over,
        "touchmove",
        [other(360), own(0, 180)],
        [own(0, 180)],
      );
      act(() => jest.advanceTimersByTime(20));
      expect(onRangeChange).not.toHaveBeenCalled();
      expect(move.defaultPrevented).toBe(false);

      // A new second contact in this plot still starts a valid pinch, even while
      // an unrelated finger precedes both owned contacts in the global list.
      expect(
        viewportTouch(
          over,
          "touchstart",
          [other(360), own(0, 180), own(2, 280)],
          [own(2, 280)],
        ).defaultPrevented,
      ).toBe(true);
      viewportTouch(
        over,
        "touchmove",
        [other(360), own(0, 130), own(2, 330)],
        [own(0, 130), own(2, 330)],
      );
      act(() => jest.advanceTimersByTime(20));
      const range = onRangeChange.mock.calls.at(-1)?.[0];
      expect(range[1] - range[0]).toBeCloseTo(25);
      viewportTouch(over, "touchend", [other(360)], [own(0, 130), own(2, 330)]);
    },
  );

  it("keeps a held chart steady when a neighboring chart finishes mounting, then releases the position on cancellation", async () => {
    render(
      <div
        role="region"
        aria-label="Scrollable charts"
        style={{ overflowY: "auto" }}
      >
        <ChartViewportContext.Provider
          value={{
            bounds: [0, 100],
            range: [25, 75],
            minSpan: 10,
            onRangeChange: jest.fn(),
            onReset: jest.fn(),
          }}
        >
          <UPlotChart
            ariaLabel="Held chart"
            state={{}}
            data={[
              [0, 100],
              [2, 3],
            ]}
            buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
          />
        </ChartViewportContext.Provider>
      </div>,
    );
    const scroll = screen.getByRole("region", { name: "Scrollable charts" });
    const plot = currentPlot();
    // The canvas mock does not attach its overlay; put it in the real scrolling ancestor.
    scroll.appendChild(plot.over);
    const neighbor = document.createElement("div");
    scroll.prepend(neighbor);
    scroll.scrollTop = 50;
    let layoutTop = 200;
    const bounds = plot.over.getBoundingClientRect();
    jest.spyOn(plot.over, "getBoundingClientRect").mockImplementation(() => ({
      ...bounds,
      top: layoutTop - scroll.scrollTop,
    }));
    const touch = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const touches =
        type === "touchstart"
          ? [100, 200].map((clientX, identifier) => ({
              identifier,
              clientX,
              clientY: 10,
              target: plot.over,
            }))
          : [];
      Object.assign(event, {
        touches,
        changedTouches: touches,
      });
      act(() => plot.over.dispatchEvent(event));
    };
    touch("touchstart");
    expect(plot.over.getBoundingClientRect().top).toBe(150);

    // A sibling canvas gets its height after the range's initial React layout has finished.
    await act(async () => {
      layoutTop = 240;
      neighbor.style.height = "160px";
      await Promise.resolve();
    });
    expect(plot.over.getBoundingClientRect().top).toBe(150);

    touch("touchcancel");
    act(() => jest.advanceTimersByTime(20));
    await act(async () => {
      layoutTop = 280;
      neighbor.style.height = "200px";
      await Promise.resolve();
    });
    expect(plot.over.getBoundingClientRect().top).toBe(190);
  });

  it("preserves the selected viewport and pointer zoom when switching controller presentation", () => {
    const onRangeChange = jest.fn();
    const viewport = {
      bounds: [0, 100] as [number, number],
      range: [25, 75] as [number, number],
      minSpan: 10,
      onRangeChange,
      onReset: jest.fn(),
    };
    const previous = uPlotPrototype.setScale.getMockImplementation();
    uPlotPrototype.setScale.mockImplementation(function (
      this: { scales?: Record<string, unknown> },
      name: string,
      range: unknown,
    ) {
      this.scales ??= {};
      this.scales[name] = range;
    });
    try {
      render(
        <ChartViewportContext.Provider value={viewport}>
          <UPlotChart
            ariaLabel="Switchable chart"
            state={{}}
            data={[
              [0, 100],
              [2, 3],
            ]}
            tooltip={() => "Chart point"}
            buildOptions={() => ({ width: 0, height: 0, series: [{}, {}] })}
          />
        </ChartViewportContext.Provider>,
      );
      for (const active of [true, false]) {
        act(() => updateInputPresentation({ active, connected: true }));
        expect(screen.getByRole("img").tabIndex).toBe(active ? 0 : -1);
        expect(currentPlot().scales.x).toEqual({ min: 25, max: 75 });
        onRangeChange.mockClear();
        act(() => {
          currentPlot().over.dispatchEvent(
            new WheelEvent("wheel", {
              ctrlKey: true,
              deltaY: -120,
              clientX: 200,
              cancelable: true,
            }),
          );
          jest.advanceTimersByTime(200);
        });
        const range = onRangeChange.mock.calls.at(-1)?.[0];
        expect(range[1] - range[0]).toBeLessThan(50);
      }
      act(() => updateInputPresentation({ active: true }));
      currentPlot().setCursor = jest.fn();
      currentPlot().valToPos = (value: number) => value;
      fireEvent.keyDown(screen.getByRole("img"), { key: "Enter" });
      expect(screen.getByRole("status")).toHaveTextContent("Chart point");
      act(() => updateInputPresentation({ active: false }));
      fireEvent.pointerDown(screen.getByRole("img"), {
        pointerType: "mouse",
        clientX: 10,
        clientY: 10,
      });
      act(() => updateInputPresentation({ active: true }));
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    } finally {
      uPlotPrototype.setScale.mockImplementation(previous ?? (() => {}));
    }
  });

  it.each(["theme", "structure", "height", "presentation"])(
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
          <ChartPresentationContext.Provider
            value={
              change === "presentation"
                ? { height: changed ? 500 : 400, fontScale: 4 / 3 }
                : null
            }
          >
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
          </ChartPresentationContext.Provider>
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
