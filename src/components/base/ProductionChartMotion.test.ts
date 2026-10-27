import uPlot from "uplot";
import { SpeedType } from "../../Types";
import { productionChartMotion } from "./ProductionChartMotion";

describe("daily production time guide", () => {
  let minute: number;
  let now: number;
  let speed: SpeedType;
  let reduced: boolean;
  let preferenceChange: () => void;
  let host: HTMLDivElement;
  let plot: uPlot;
  let motion: ReturnType<typeof productionChartMotion>;
  const range: [number, number] = [0, 60];
  const marker = () =>
    host.querySelector<HTMLElement>("[data-production-now]")!;
  function hook(name: "init" | "draw" | "destroy") {
    const callbacks = motion.plugin.hooks![name];
    if (typeof callbacks === "function")
      callbacks(plot, {} as uPlot.Options, plot.data);
    else
      callbacks?.forEach((callback) =>
        callback?.(plot, {} as uPlot.Options, plot.data),
      );
  }
  function advance(at: number) {
    const elapsed = at - now;
    now = at;
    jest.advanceTimersByTime(elapsed);
  }
  function draw(atMinute: number, atTime: number, sameData = false) {
    advance(atTime);
    minute = atMinute;
    if (!sameData)
      Object.assign(plot, {
        data: [
          [0, 15, 30, 45, 60],
          [1, 2, 3, 4, 5],
        ],
      });
    hook("draw");
  }
  beforeEach(() => {
    minute = 15;
    now = 0;
    speed = "SLOW";
    reduced = false;
    range[0] = 0;
    range[1] = 60;
    preferenceChange = () => undefined;
    jest.useFakeTimers();
    jest.spyOn(performance, "now").mockImplementation(() => now);
    jest.spyOn(window, "requestAnimationFrame");
    jest.spyOn(window, "matchMedia").mockImplementation(
      () =>
        ({
          get matches() {
            return reduced;
          },
          addEventListener: (_event: string, listener: () => void) => {
            preferenceChange = listener;
          },
          removeEventListener: jest.fn(),
        }) as unknown as MediaQueryList,
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    const root = document.createElement("div");
    const canvas = document.createElement("canvas");
    const over = document.createElement("div");
    host.appendChild(root);
    root.append(canvas, over);
    plot = {
      root,
      over,
      ctx: {
        canvas,
        save: jest.fn(),
        restore: jest.fn(),
        measureText: () => ({ width: 24 }),
      },
      bbox: { left: 0, top: 20, width: 60, height: 40 },
      scales: { x: { min: 0, max: 60 } },
      valToPos: (value: number) =>
        ((value - range[0]) * plot.bbox.width) / (range[1] - range[0]),
    } as unknown as uPlot;
    motion = productionChartMotion(() => ({ minute, range, speed }));
    hook("init");
    draw(15, 0);
  });
  afterEach(() => {
    hook("destroy");
    host.remove();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it("adds a halfway position between native ticks without scheduling chart redraws or changing data", () => {
    draw(30, 200);
    const data = plot.data;
    expect(marker().style.transform).toBe("translateX(15px)");
    advance(300);
    expect(marker().style.transform).toBe("translateX(22.5px)");
    expect(plot.data).toBe(data);
    draw(45, 400);
    expect(marker().style.transform).toBe("translateX(30px)");
    expect(marker()).toHaveAttribute("aria-hidden", "true");
    expect(marker().style.pointerEvents).toBe("none");
    expect(marker().textContent).toBe("Now");
    expect(marker().nextSibling).toBe(plot.over);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });
  it("continues an interrupted transition from its displayed position", () => {
    draw(30, 200);
    advance(300);
    draw(45, 300);
    expect(marker().style.transform).toBe("translateX(22.5px)");
    advance(400);
    expect(marker().style.transform).toBe("translateX(33.75px)");
  });
  it("lands on the endpoint if the next native tick is delayed", () => {
    draw(30, 200);
    advance(420);
    expect(marker().style.transform).toBe("translateX(30px)");
    expect(jest.getTimerCount()).toBe(0);
  });
  it("retains annotation redraw progress and snaps for forecast edits or skipped ticks", () => {
    draw(30, 200);
    draw(30, 250, true);
    advance(300);
    expect(marker().style.transform).toBe("translateX(22.5px)");
    draw(30, 300);
    expect(marker().style.transform).toBe("translateX(30px)");
    expect(jest.getTimerCount()).toBe(0);
    draw(60, 400);
    expect(marker().style.display).toBe("none");
  });
  it("snaps after geometry and day-range changes", () => {
    draw(30, 200);
    plot.bbox.width = 120;
    draw(30, 250, true);
    expect(marker().style.transform).toBe("translateX(60px)");
    expect(jest.getTimerCount()).toBe(0);
    range[0] = 60;
    range[1] = 120;
    draw(75, 400);
    expect(marker().style.transform).toBe("translateX(30px)");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("keeps the label clamped at both edges and resumes motion when it fits", () => {
    range[1] = 600;
    draw(15, 100);
    draw(30, 300);
    expect(jest.getTimerCount()).toBe(0);
    expect(
      Number.parseFloat(marker().querySelector("span")!.style.left) + 3,
    ).toBe(12);
    draw(135, 400);
    draw(150, 600);
    expect(jest.getTimerCount()).toBe(2);
    draw(555, 700);
    draw(570, 900);
    expect(jest.getTimerCount()).toBe(0);
    expect(
      Number.parseFloat(marker().querySelector("span")!.style.left) + 57,
    ).toBe(48);
  });
  it("restores native guides at pause and faster speeds, then resumes without stale motion", () => {
    draw(30, 200);
    for (const value of ["PAUSED", "NORMAL", "FAST", "ULTRA"] as const) {
      speed = value;
      draw(30, 250);
      expect(marker().style.display).toBe("none");
      expect(motion.active()).toBe(false);
    }
    speed = "SLOW";
    draw(30, 300);
    expect(jest.getTimerCount()).toBe(0);
    draw(45, 500);
    expect(jest.getTimerCount()).toBe(2);
  });
  it("honors reduced motion and visibility changes immediately", () => {
    draw(30, 200);
    reduced = true;
    preferenceChange();
    expect(jest.getTimerCount()).toBe(0);
    expect(marker().style.transform).toBe("translateX(30px)");
    draw(45, 400);
    expect(jest.getTimerCount()).toBe(0);
    reduced = false;
    draw(30, 500);
    draw(45, 700);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(jest.getTimerCount()).toBe(0);
    jest.spyOn(document, "hidden", "get").mockReturnValue(true);
    draw(30, 800);
    draw(45, 1000);
    expect(jest.getTimerCount()).toBe(0);
  });
  it("snaps on inspection and removes listeners after uPlot detaches", () => {
    draw(30, 200);
    plot.over.dispatchEvent(new Event("pointerenter"));
    expect(jest.getTimerCount()).toBe(0);
    draw(45, 400);
    expect(jest.getTimerCount()).toBe(0);
    plot.over.dispatchEvent(new Event("pointerleave"));
    draw(30, 500);
    draw(45, 700);
    host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(jest.getTimerCount()).toBe(0);
    plot.root.remove();
    expect(() => hook("destroy")).not.toThrow();
    expect(host.querySelector("[data-production-now]")).toBeNull();
    host.dispatchEvent(new Event("pointerdown"));
  });
});
