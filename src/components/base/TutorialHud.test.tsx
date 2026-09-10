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
    content: (
      <TutorialPrompt
        concepts={["supply", "demand"]}
        text="Keep supply above demand."
      />
    ),
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

  it("exposes the current objective, progress and ordinary navigation", async () => {
    const user = userEvent.setup();
    const hudProps = props({ canGoBack: true, stepIndex: 1 });
    render(<TutorialHud {...hudProps} />);

    expect(
      screen.getByRole("region", { name: "Mission objective" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Objective 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Keep supply above demand.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Exit" }));
    expect(hudProps.onBack).toHaveBeenCalledTimes(1);
    expect(hudProps.onNext).toHaveBeenCalledTimes(1);
    expect(hudProps.onExit).toHaveBeenCalledTimes(1);
  });

  it("reveals help only when requested and has no redundant Next for gates", async () => {
    const user = userEvent.setup();
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

    expect(screen.queryByText("Look at the reserve readout.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByText("Complete objective")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Hint" }));
    expect(screen.getByRole("note")).toHaveTextContent(
      "Look at the reserve readout.",
    );
    expect(screen.getByRole("button", { name: "Hide hint" })).toHaveFocus();
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

    act(() => jest.advanceTimersByTime(9_999));
    expect(target).not.toHaveClass("tutorialTargetReminder");
    act(() => jest.advanceTimersByTime(1));
    expect(target).toHaveClass("tutorialTargetReminder");

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
    expect(
      screen.getByRole("region", { name: "Your turn" }),
    ).toBeInTheDocument();

    unmount();
    target.remove();
    jest.useRealTimers();
  });
});
