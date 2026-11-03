import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../Store";
import { delta, markEventsRead } from "../../reducers/Game";
import { ActiveWorldEventType } from "../../Types";
import Navigation from "./Navigation";
import {
  resetInputPresentation,
  updateInputPresentation,
} from "../../desktop/InputPresentation";

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
  resetInputPresentation();
  document.elementFromPoint = originalElementFromPoint;
  jest.useRealTimers();
});

describe("Navigation", () => {
  beforeEach(() => {
    store.dispatch(
      delta({
        scenarioId: 103,
        tutorialStep: 0,
        worldEvents: { active: [], occurrences: [], checkedKeys: [] },
        eventLog: [],
        eventLogReadThroughId: 0,
      }),
    );
  });

  it("keeps an emergency alert after reading events and resuming until the last emergency ends", () => {
    const minute = store.getState().game.date.minute;
    const emergency: ActiveWorldEventType = {
      key: "wildfire",
      definitionId: "wildfire",
      startsMinute: minute,
      endsMinute: minute + 10,
      importance: "CRITICAL",
      attributes: {},
      effects: {},
    };
    store.dispatch(
      delta({
        speed: "PAUSED",
        worldEvents: {
          active: [
            emergency,
            { ...emergency, key: "other", endsMinute: minute + 20 },
          ],
          occurrences: [],
          checkedKeys: [],
        },
        eventLog: [
          { id: 1, kind: "WORLD_EVENT", label: "Now", message: "Wildfire" },
        ],
      }),
    );
    renderNavigation();
    const events = screen.getByRole("button", { name: "Events" });
    expect(events).toHaveAccessibleDescription(/Ongoing emergency/);
    expect(screen.getByTestId("ErrorIcon")).toBeVisible();
    act(() => {
      store.dispatch(markEventsRead());
      store.dispatch(delta({ speed: "NORMAL" }));
    });
    expect(events).toHaveAccessibleDescription("Ongoing emergency");
    for (const elapsed of [10, 19]) {
      act(() =>
        store.dispatch(
          delta({
            date: { ...store.getState().game.date, minute: minute + elapsed },
          }),
        ),
      );
      expect(screen.getByTestId("ErrorIcon")).toBeVisible();
    }
    act(() =>
      store.dispatch(
        delta({ date: { ...store.getState().game.date, minute: minute + 20 } }),
      ),
    );
    expect(screen.queryByTestId("ErrorIcon")).toBeNull();
    expect(events).not.toHaveAccessibleDescription();
  });

  it.each(["NOTABLE", "future", "expired"])(
    "does not mark %s events as ongoing emergencies",
    (kind) => {
      const minute = store.getState().game.date.minute;
      store.dispatch(
        delta({
          worldEvents: {
            active: [
              {
                key: kind,
                definitionId: kind,
                startsMinute: minute + (kind === "future" ? 1 : 0),
                endsMinute: minute + (kind === "expired" ? 0 : 10),
                importance: kind === "NOTABLE" ? "NOTABLE" : "CRITICAL",
                attributes: {},
                effects: {},
              },
            ],
            occurrences: [],
            checkedKeys: [],
          },
          eventLog: [
            { id: 1, kind: "WORLD_EVENT", label: "Now", message: "Update" },
          ],
        }),
      );
      renderNavigation();
      expect(screen.queryByTestId("ErrorIcon")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Events" }),
      ).toHaveAccessibleDescription("Unread events");
    },
  );
  it("groups the four game tools in a labeled action dock", () => {
    renderNavigation();

    expect(
      screen.getByRole("navigation", { name: "Game actions" }),
    ).toBeVisible();
    for (const name of ["Build", "Programs", "Insights", "Events"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeVisible();
      expect(button).toHaveTextContent(name);
    }
    expect(screen.queryByRole("button", { name: "Facilities" })).toBeNull();
  });

  it("opens the scenario as a tool like the others", () => {
    const onToggle = jest.fn();
    store.dispatch(delta({ scenarioId: 103 }));
    renderNavigation(onToggle);
    const scenario = screen.getByRole("button", { name: "Scenario" });
    expect(scenario).toHaveAttribute("aria-keyshortcuts", "T");
    fireEvent.click(scenario);
    expect(onToggle).toHaveBeenCalledWith("SCENARIO");
  });

  it("leaves the scenario out of tutorials, which have no score", () => {
    store.dispatch(delta({ scenarioId: 0 }));
    renderNavigation();
    expect(screen.queryByRole("button", { name: "Scenario" })).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it.each<[number, number, string[]]>([
    [1, 0, ["Build"]],
    [2, 0, ["Build"]],
    [4, 0, ["Build", "Insights"]],
    [4, 3, ["Build", "Programs", "Insights"]],
    [3, 0, ["Build", "Programs", "Insights"]],
    [5, 0, ["Build", "Programs", "Insights"]],
    [5, 5, ["Build", "Programs", "Insights", "Events"]],
    [112, 0, ["Build", "Programs", "Insights", "Events"]],
    [112, 19, ["Build", "Programs", "Insights", "Events"]],
  ])(
    "shows only taught actions in tutorial %s step %s",
    (scenarioId, tutorialStep, actions) => {
      store.dispatch(
        delta({
          scenarioId,
          tutorialStep,
        }),
      );
      renderNavigation();
      expect(
        screen
          .getAllByRole("button")
          .map((button) => button.getAttribute("aria-label")),
      ).toEqual(actions);
      expect(screen.queryByRole("button", { name: "Scenario" })).toBeNull();
    },
  );

  it("labels hovered and keyboard-focused icons with their shortcut without opening a tool", async () => {
    const onToggle = jest.fn();
    renderNavigation(onToggle);
    const build = screen.getByRole("button", { name: "Build" });
    expect(build).toHaveAttribute("aria-keyshortcuts", "Q");
    fireEvent.pointerEnter(build, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toHaveTextContent(/^Build \(Q\)$/);
    fireEvent.pointerLeave(build, { pointerType: "mouse" });
    const programs = screen.getByRole("button", { name: "Programs" });
    await act(async () => programs.focus());
    expect(screen.getByRole("tooltip", { name: "Programs (W)" })).toBeVisible();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("keeps dock help free of keyboard prompts while the controller is active", async () => {
    renderNavigation();
    const build = screen.getByRole("button", { name: "Build" });
    act(() => updateInputPresentation({ active: true, connected: true }));
    await act(async () => build.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent(/^Build$/);
    act(() => updateInputPresentation({ active: false }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/^Build \(Q\)$/);
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
    // A touch preview names the tool alone: there may be no keyboard to press it on.
    expect(screen.getByRole("tooltip")).toHaveTextContent(/^Build$/);
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
