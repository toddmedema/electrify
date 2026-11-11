import {
  failDesktopStartup,
  finishStartup,
  prepareDesktopStartup,
} from "./Startup";

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(performance, "now").mockReturnValue(1100);
  document.body.innerHTML =
    '<div id="root"></div><div id="appStartup" data-started-at="1000"></div>';
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

it("holds a warm startup until 500ms after the entrance appeared, including duplicate commits", () => {
  const root = document.getElementById("root")!;
  finishStartup();
  finishStartup();
  expect(document.getElementById("appStartup")).not.toBeNull();
  expect(root.inert).toBe(true);
  expect(root).not.toBeVisible();
  jest.advanceTimersByTime(399);
  expect(document.getElementById("appStartup")).not.toBeNull();
  jest.advanceTimersByTime(1);
  expect(document.getElementById("appStartup")).toBeNull();
  expect(root.inert).toBe(false);
  expect(root).toBeVisible();
  expect(jest.getTimerCount()).toBe(0);
});

it("does not add a delay to an already slow startup", () => {
  jest.mocked(performance.now).mockReturnValue(1800);
  finishStartup();
  expect(document.getElementById("appStartup")).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

it("leaves the app usable when a failed load has already removed the entrance", () => {
  document.getElementById("appStartup")!.remove();
  finishStartup();
  expect(document.getElementById("root")!.inert).not.toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

describe("the startup message", () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="root"></div><div id="appStartup"><div data-startup-status role="status">Loading…</div></div>';
  });

  it("leaves the painted entrance untouched so its message never changes", () => {
    const status = document.querySelector("[data-startup-status]")!;
    const text = status.firstChild;
    prepareDesktopStartup();
    expect(status.firstChild).toBe(text);
    expect(status).toHaveTextContent("Loading…");
  });

  it("restores the same message when a failed startup is retried", () => {
    failDesktopStartup(jest.fn(), jest.fn());
    const entrance = document.getElementById("appStartup")!;
    const status = entrance.querySelector("[data-startup-status]")!;
    expect(entrance).toHaveClass("appStartupFailed");
    expect(status).toHaveAttribute("role", "alert");
    prepareDesktopStartup();
    expect(entrance).not.toHaveClass("appStartupFailed");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent("Loading…");
    expect(status.querySelector("button")).toBeNull();
  });
});
