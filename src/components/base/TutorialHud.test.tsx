import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { TutorialStepType } from "../../Types";
import TutorialHud, { TutorialHudProps } from "./TutorialHud";
import TutorialPrompt from "./TutorialPrompt";

function objective(
  overrides: Partial<TutorialStepType> = {},
): TutorialStepType {
  return {
    card: "FACILITIES",
    target: "#tutorial-target",
    action: "Tap the target",
    content: <TutorialPrompt text="Keep supply above demand." />,
    ...overrides,
  };
}

function props(overrides: Partial<TutorialHudProps> = {}): TutorialHudProps {
  return {
    desktop: false,
    onBack: jest.fn(),
    onExit: jest.fn(),
    onNext: jest.fn(),
    step: objective(),
    stepIndex: 0,
    totalSteps: 3,
    canGoBack: false,
    ...overrides,
  };
}

describe("TutorialHud", () => {
  it("names a deliberate challenge transition without advancing from unrelated controls", async () => {
    const user = userEvent.setup();
    const hudProps = props({
      step: objective({ nextLabel: "Start final challenge" }),
    });
    render(
      <>
        <button>1×</button>
        <TutorialHud {...hudProps} />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "1×" }));
    expect(hudProps.onNext).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Start final challenge" }),
    );
    expect(hudProps.onNext).toHaveBeenCalledTimes(1);
  });
  it("continues on explicit UI controls, including keyboard activation, and cleans up", async () => {
    const user = userEvent.setup();
    const hudProps = props({ step: objective({ continueOnClick: "#tab" }) });
    const { rerender } = render(
      <>
        <button id="tab">
          <span>Interties</span>
        </button>
        <button>Unrelated</button>
        <TutorialHud {...hudProps} />
      </>,
    );
    await user.click(screen.getByText("Unrelated"));
    expect(hudProps.onNext).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "Interties" }).focus();
    await user.keyboard("{Enter}");
    expect(hudProps.onNext).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Next" })).toBeVisible();
    // The deed is the step's main call to action; Next is only its quiet fallback
    expect(screen.getByRole("button", { name: "Next" })).not.toHaveClass(
      "MuiButton-contained",
    );
    rerender(
      <>
        <button id="tab">Interties</button>
        <TutorialHud {...hudProps} step={objective()} />
      </>,
    );
    await user.click(screen.getByText("Interties"));
    expect(hudProps.onNext).toHaveBeenCalledTimes(1);
  });

  it("ignores disabled controls and cancels a click when its action removes the objective", async () => {
    const user = userEvent.setup();
    const hudProps = props({ step: objective({ continueOnClick: "#tab" }) });
    const { rerender } = render(
      <>
        <button id="tab" disabled>
          Interties
        </button>
        <TutorialHud {...hudProps} />
      </>,
    );
    await user.click(screen.getByText("Interties"));
    expect(hudProps.onNext).not.toHaveBeenCalled();
    rerender(
      <>
        <button id="tab" onClick={() => rerender(<span>Finished</span>)}>
          Interties
        </button>
        <TutorialHud {...hudProps} />
      </>,
    );
    await user.click(screen.getByText("Interties"));
    expect(hudProps.onNext).not.toHaveBeenCalled();
  });

  it("does not count a click on a required purchase gate", async () => {
    const user = userEvent.setup();
    const hudProps = props({
      step: objective({ continueOnClick: "button", advanceOn: () => false }),
    });
    render(
      <>
        <button>Buy</button>
        <TutorialHud {...hudProps} />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Buy" }));
    expect(hudProps.onNext).not.toHaveBeenCalled();
  });

  it("exposes the current step, progress and ordinary navigation", async () => {
    const user = userEvent.setup();
    const hudProps = props({ canGoBack: true, stepIndex: 1 });
    render(<TutorialHud {...hudProps} />);

    expect(
      screen.getByRole("region", { name: "Step 2 of 3" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Step 2 of 3" }),
    ).toHaveTextContent("2/3");
    expect(screen.getByText("Keep supply above demand.")).toBeInTheDocument();
    expect(screen.getByText("Tap the target")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Next" })).toHaveClass(
      "MuiButton-contained",
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Exit" }));
    expect(hudProps.onBack).toHaveBeenCalledTimes(1);
    expect(hudProps.onNext).toHaveBeenCalledTimes(1);
    expect(hudProps.onExit).toHaveBeenCalledTimes(1);
  });

  it("always shows help and has no redundant Next for gates", () => {
    render(
      <TutorialHud
        {...props({
          step: objective({
            advanceOn: () => false,
            hint: "Look at the reserve readout.",
          }),
        })}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      "Look at the reserve readout.",
    );
    expect(screen.queryByRole("button", { name: /hint/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByText("Complete objective")).toBeNull();
  });

  it("delays target reminders and never points out a capstone answer", () => {
    jest.useFakeTimers();
    const target = document.createElement("button");
    target.id = "tutorial-target";
    document.body.appendChild(target);

    const hudProps = props();
    const { rerender, unmount } = render(<TutorialHud {...hudProps} />);
    expect(target).toHaveClass("tutorialTarget");
    expect(target).not.toHaveClass("tutorialTargetReminder");
    const ring = screen.getByTestId("tutorial-target-ring");
    expect(ring).toBeInTheDocument();
    // One pulse right away points out where to act, before the slower reminder starts
    expect(ring).toHaveClass("tutorialTargetRingIntro");

    act(() => jest.advanceTimersByTime(9_999));
    expect(target).not.toHaveClass("tutorialTargetReminder");
    act(() => jest.advanceTimersByTime(1));
    expect(target).toHaveClass("tutorialTargetReminder");
    expect(ring).toHaveClass("tutorialTargetRingPulse");
    expect(ring).not.toHaveClass("tutorialTargetRingIntro");

    rerender(
      <TutorialHud
        {...hudProps}
        step={objective({
          capstone: {
            success: () => false,
            successMessage: "Ready in time.",
            failureMessage: "Capacity arrived late.",
          },
        })}
      />,
    );
    expect(target).not.toHaveClass("tutorialTarget");
    expect(screen.queryByTestId("tutorial-target-ring")).toBeNull();
    expect(
      screen.getByRole("region", { name: /Your turn/ }),
    ).toBeInTheDocument();

    unmount();
    target.remove();
    jest.useRealTimers();
  });

  // jsdom lays nothing out, so these tests stub the target's box. The viewport is 1024x768 and
  // no ancestor clips, so the clipping bounds are the viewport itself.
  function stubRect(
    element: Element,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) {
    element.getBoundingClientRect = () =>
      ({
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  it("reveals the first choice once and leaves subsequent player scrolling alone", () => {
    jest.useFakeTimers();
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1600 },
      clientHeight: { value: 400 },
    });
    stubRect(scroller, 0, 100, 500, 500);
    const targets = [600, 1000].map((top) => {
      const target = document.createElement("button");
      target.className = "purchase-choice";
      target.getBoundingClientRect = () =>
        ({
          left: 0,
          right: 500,
          top: top - scroller.scrollTop,
          bottom: top + 44 - scroller.scrollTop,
          width: 500,
          height: 44,
        }) as DOMRect;
      scroller.appendChild(target);
      return target;
    });
    document.body.appendChild(scroller);
    const { unmount } = render(
      <TutorialHud
        {...props({ step: objective({ target: ".purchase-choice" }) })}
      />,
    );
    act(() => jest.advanceTimersByTime(500));
    expect(scroller.scrollTop).toBe(144);
    expect(targets[0].getBoundingClientRect().bottom).toBe(500);
    scroller.scrollTop = 0;
    act(() => jest.advanceTimersByTime(1000));
    expect(scroller.scrollTop).toBe(0);
    // Responsive CSS can move a target without replacing its node. A settled resize
    // should reveal it once more, while later manual scrolling remains respected.
    act(() => window.dispatchEvent(new Event("resize")));
    act(() => jest.advanceTimersByTime(500));
    expect(scroller.scrollTop).toBe(144);
    scroller.scrollTop = 0;
    act(() => jest.advanceTimersByTime(1000));
    expect(scroller.scrollTop).toBe(0);
    unmount();
    scroller.remove();
    jest.useRealTimers();
  });

  it("gives the ring a small gap when the control is not flush with a clipping edge", () => {
    const target = document.createElement("div");
    target.id = "tutorial-target";
    stubRect(target, 200, 150, 400, 250);
    document.body.appendChild(target);

    const { unmount } = render(<TutorialHud {...props()} />);
    const ring = screen.getByTestId("tutorial-target-ring");
    expect(ring).toBeInTheDocument();
    // 3px gap plus the 2px line on every side.
    expect(ring.style.left).toBe("195px");
    expect(ring.style.top).toBe("145px");
    expect(ring.style.width).toBe("210px");
    expect(ring.style.height).toBe("110px");

    unmount();
    target.remove();
  });

  it("keeps every side of the ring visible when the control runs edge to edge", () => {
    const target = document.createElement("div");
    target.id = "tutorial-target";
    // Flush with the viewport's left and right, like the facilities chart on a phone or in a
    // pane. An outline lost its sides here; the ring must not.
    stubRect(target, 0, 150, 1024, 250);
    document.body.appendChild(target);

    const { unmount } = render(<TutorialHud {...props()} />);
    const ring = screen.getByTestId("tutorial-target-ring");
    expect(ring).toBeInTheDocument();
    // No room outside on the left and right, so the ring frames the control from inside on
    // every side rather than sitting outside it on two and on top of it on the others.
    expect(ring.style.top).toBe("150px");
    expect(ring.style.height).toBe("100px");
    expect(ring.style.left).toBe("0px");
    expect(ring.style.width).toBe("1024px");

    unmount();
    target.remove();
  });

  it("tracks moving targets on every animation frame and stops after unmount", () => {
    let nextFrame: FrameRequestCallback | undefined;
    const requestFrame = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        nextFrame = callback;
        return 1;
      });
    const cancelFrame = jest.spyOn(window, "cancelAnimationFrame");
    const target = document.createElement("div");
    target.id = "tutorial-target";
    stubRect(target, 200, 150, 400, 250);
    document.body.appendChild(target);

    const { unmount } = render(<TutorialHud {...props()} />);
    const ring = screen.getByTestId("tutorial-target-ring");
    // Scroll motion must be reflected at the next paint, including frames less than 66ms
    // apart. This also covers pane dragging and layout animation without scroll events.
    for (const [time, top] of [
      [16, 130],
      [32, 110],
      [48, 90],
    ]) {
      stubRect(target, 200, top, 400, top + 100);
      const frame = nextFrame!;
      act(() => frame(time));
      expect(ring.style.top).toBe(`${top - 5}px`);
    }

    unmount();
    expect(cancelFrame).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId("tutorial-target-ring")).toBeNull();
    target.remove();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it("restores target hooks overwritten by a render without replacing its ring", () => {
    jest.useFakeTimers();
    const target = document.createElement("div");
    target.id = "tutorial-target";
    stubRect(target, 200, 150, 400, 250);
    document.body.appendChild(target);
    const { unmount } = render(<TutorialHud {...props()} />);
    const ring = screen.getByTestId("tutorial-target-ring");
    target.className = "facilityRowHeader ready";
    act(() => jest.advanceTimersByTime(20));
    expect(target).toHaveClass("tutorialTarget", "ready");
    expect(screen.getByTestId("tutorial-target-ring")).toBe(ring);
    act(() => jest.advanceTimersByTime(10_000));
    target.className = "facilityRowHeader ready";
    act(() => jest.advanceTimersByTime(20));
    expect(target).toHaveClass(
      "tutorialTarget",
      "tutorialTargetReminder",
      "ready",
    );
    expect(screen.getByTestId("tutorial-target-ring")).toBe(ring);
    unmount();
    expect(target).not.toHaveClass("tutorialTarget", "tutorialTargetReminder");
    target.remove();
    jest.useRealTimers();
  });

  it("keeps the gap even on every side when one side has only a little room", () => {
    const target = document.createElement("div");
    target.id = "tutorial-target";
    // 4px from the viewport's right edge, like the speed buttons on a phone.
    stubRect(target, 800, 20, 1020, 60);
    document.body.appendChild(target);

    const { unmount } = render(<TutorialHud {...props()} />);
    const ring = screen.getByTestId("tutorial-target-ring");
    expect(ring.style.left).toBe("796px");
    expect(ring.style.top).toBe("16px");
    expect(ring.style.width).toBe("228px");
    expect(ring.style.height).toBe("48px");

    unmount();
    target.remove();
  });

  it("keeps the gap for a control flush with a pane that clips but does not scroll", () => {
    // The Build button fills the desktop pane header, so its top edge is the pane's top edge.
    const pane = document.createElement("div");
    pane.style.overflow = "hidden";
    stubRect(pane, 0, 100, 425, 768);
    const target = document.createElement("button");
    target.id = "tutorial-target";
    stubRect(target, 320, 100, 410, 140);
    pane.appendChild(target);
    document.body.appendChild(pane);

    const { unmount } = render(<TutorialHud {...props()} />);
    const ring = screen.getByTestId("tutorial-target-ring");
    expect(ring.style.top).toBe("95px");
    expect(ring.style.height).toBe("50px");

    unmount();
    pane.remove();
  });

  it("draws one ring around targets that touch edge to edge", () => {
    const rows = [150, 220].map((top) => {
      const row = document.createElement("div");
      row.className = "tutorial-row";
      stubRect(row, 200, top, 600, top + 70);
      document.body.appendChild(row);
      return row;
    });

    const { unmount } = render(
      <TutorialHud
        {...props({ step: objective({ target: ".tutorial-row" }) })}
      />,
    );
    const visible = screen
      .getAllByTestId("tutorial-target-ring")
      .filter((ring) => ring.style.display !== "none");
    expect(visible).toHaveLength(1);
    expect(visible[0].style.top).toBe("145px");
    expect(visible[0].style.height).toBe("150px");

    unmount();
    rows.forEach((row) => row.remove());
  });

  it("hides the ring while its target has no box", () => {
    const target = document.createElement("div");
    target.id = "tutorial-target";
    stubRect(target, 0, 0, 0, 0);
    document.body.appendChild(target);

    const { unmount } = render(<TutorialHud {...props()} />);
    const ring = screen.getByTestId("tutorial-target-ring");
    expect(ring).toBeInTheDocument();
    expect(ring.style.display).toBe("none");

    unmount();
    target.remove();
  });
  it("follows a target that mounts late or is replaced during the step", () => {
    jest.useFakeTimers();
    const { unmount } = render(<TutorialHud {...props()} />);
    expect(screen.queryByTestId("tutorial-target-ring")).toBeNull();

    // The control mounts after the step starts, like a list that is still loading.
    const first = document.createElement("div");
    first.id = "tutorial-target";
    stubRect(first, 200, 150, 400, 250);
    document.body.appendChild(first);
    act(() => jest.advanceTimersByTime(100));
    expect(first).toHaveClass("tutorialTarget");
    expect(screen.getAllByTestId("tutorial-target-ring")).toHaveLength(1);

    // The layout swaps it for a new node after the reminder has started.
    act(() => jest.advanceTimersByTime(10_000));
    first.remove();
    const second = document.createElement("div");
    second.id = "tutorial-target";
    stubRect(second, 0, 150, 1024, 250);
    document.body.appendChild(second);
    act(() => jest.advanceTimersByTime(100));
    expect(second).toHaveClass("tutorialTarget", "tutorialTargetReminder");
    expect(first).not.toHaveClass("tutorialTarget");
    const rings = screen.getAllByTestId("tutorial-target-ring");
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveClass("tutorialTargetRingPulse");
    expect(rings[0].style.left).toBe("0px");

    unmount();
    expect(screen.queryByTestId("tutorial-target-ring")).toBeNull();
    expect(second).not.toHaveClass("tutorialTarget");
    second.remove();
    jest.useRealTimers();
  });

  it("stops the ring above a sticky bar lying across the control", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    stubRect(scroller, 0, 0, 1024, 768);
    const target = document.createElement("div");
    target.id = "tutorial-target";
    stubRect(target, 0, 600, 1024, 900);
    const footer = document.createElement("nav");
    footer.style.position = "sticky";
    footer.style.bottom = "0px";
    stubRect(footer, 0, 700, 1024, 768);
    scroller.append(target, footer);
    document.body.appendChild(scroller);

    const { unmount } = render(<TutorialHud {...props()} />);
    const ring = screen.getByTestId("tutorial-target-ring");
    // The bar cuts the bottom, so the ring ends at the bar; the control spans the scroller's
    // width, so the rest of the ring frames it from inside.
    expect(ring.style.top).toBe("600px");
    expect(ring.style.height).toBe("100px");

    unmount();
    scroller.remove();
  });
});
