import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../Store";
import Navigation from "./Navigation";

function renderNavigation(onToggle = jest.fn()) {
  return render(
    <Provider store={store}>
      <Navigation onToggle={onToggle} />
    </Provider>,
  );
}

// jsdom has no PointerEvent; keep the pointer identity and type used by the gesture.
class TestPointerEvent extends MouseEvent {
  pointerType: string;
  pointerId: number;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? "touch";
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}

const originalPointerEvent = window.PointerEvent;
const originalElementFromPoint = document.elementFromPoint;
beforeAll(() => {
  window.PointerEvent = TestPointerEvent as typeof PointerEvent;
});
afterAll(() => {
  window.PointerEvent = originalPointerEvent;
});
afterEach(() => {
  document.elementFromPoint = originalElementFromPoint;
  jest.useRealTimers();
});

describe("Navigation", () => {
  it("groups the four game tools in a labeled action dock", () => {
    renderNavigation();

    expect(
      screen.getByRole("navigation", { name: "Game actions" }),
    ).toBeVisible();
    for (const name of ["Build", "Programs", "Insights", "Events"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeVisible();
      expect(button).not.toHaveTextContent(name);
    }
    expect(screen.queryByRole("button", { name: "Facilities" })).toBeNull();
  });

  it("labels hovered and keyboard-focused icons without opening a tool", async () => {
    const onToggle = jest.fn();
    renderNavigation(onToggle);
    const build = screen.getByRole("button", { name: "Build" });
    fireEvent.pointerEnter(build, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Build");
    fireEvent.pointerLeave(build, { pointerType: "mouse" });
    const programs = screen.getByRole("button", { name: "Programs" });
    await act(async () => programs.focus());
    expect(screen.getByRole("tooltip", { name: "Programs" })).toBeVisible();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("previews labels after holding the dock padding and scrubbing, without activating on release", () => {
    jest.useFakeTimers();
    const onToggle = jest.fn();
    renderNavigation(onToggle);
    const dock = screen.getByRole("navigation");
    const build = screen.getByRole("button", { name: "Build" });
    const events = screen.getByRole("button", { name: "Events" });
    const hitTest = jest.fn().mockReturnValue(dock);
    document.elementFromPoint = hitTest;
    fireEvent.pointerDown(dock, { clientX: 10, clientY: 10 });
    act(() => jest.advanceTimersByTime(600));
    expect(screen.queryByRole("tooltip")).toBeNull();
    hitTest.mockReturnValue(screen.getByTestId("BuildIcon"));
    fireEvent.pointerMove(dock, { clientX: 30, clientY: 30 });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Build");
    // Native touch capture transfers from the original button to the dock.
    fireEvent.lostPointerCapture(build);
    hitTest.mockReturnValue(events);
    fireEvent.pointerMove(dock, { clientX: 180, clientY: 30 });
    act(() => jest.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Events");
    fireEvent.pointerUp(events);
    fireEvent.click(events, { detail: 1 });
    act(() => jest.advanceTimersByTime(300));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
    // The next ordinary tap still activates immediately.
    fireEvent.pointerDown(build);
    fireEvent.pointerUp(build);
    fireEvent.click(build, { detail: 1 });
    expect(onToggle).toHaveBeenCalledWith("BUILD_GENERATORS");
  });

  it.each(["pointerUp", "pointerCancel", "pointerMove"] as const)(
    "cancels a pending hold on %s",
    (event) => {
      jest.useFakeTimers();
      renderNavigation();
      const dock = screen.getByRole("navigation");
      document.elementFromPoint = jest
        .fn()
        .mockReturnValue(screen.getByRole("button", { name: "Build" }));
      fireEvent.pointerDown(dock, { clientX: 10, clientY: 10 });
      fireEvent[event](dock, { clientX: 40, clientY: 10 });
      act(() => jest.advanceTimersByTime(1000));
      expect(screen.queryByRole("tooltip")).toBeNull();
    },
  );

  it("exposes the open panels and toggles a dock tool", () => {
    const onToggle = jest.fn();
    render(
      <Provider store={store}>
        <Navigation openTools={["INSIGHTS"]} onToggle={onToggle} />
      </Provider>,
    );
    const insights = screen.getByRole("button", { name: "Insights" });
    expect(insights).toHaveAttribute("aria-expanded", "true");
    expect(insights).toHaveAttribute("aria-controls", "tool-INSIGHTS");
    insights.click();
    expect(onToggle).toHaveBeenCalledWith("INSIGHTS");
  });
});
