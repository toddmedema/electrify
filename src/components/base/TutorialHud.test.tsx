import { fireEvent, render, screen } from "@testing-library/react";
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

  it("keeps collapsed state across objective changes and expands on focus", async () => {
    const user = userEvent.setup();
    const hudProps = props();
    const { rerender } = render(<TutorialHud {...hudProps} />);

    await user.click(
      screen.getByRole("button", { name: "Collapse objective" }),
    );
    expect(
      screen.getByRole("button", { name: "Expand objective" }),
    ).toHaveAttribute("aria-expanded", "false");

    rerender(
      <TutorialHud
        {...hudProps}
        step={objective({
          content: (
            <TutorialPrompt concepts={["money"]} text="Protect your cash." />
          ),
        })}
        stepIndex={1}
      />,
    );
    const expand = screen.getByRole("button", { name: "Expand objective" });
    fireEvent.focus(expand);
    expect(
      screen.getByRole("button", { name: "Collapse objective" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Protect your cash.")).toBeInTheDocument();
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
    expect(screen.getByText("Complete objective")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hint" }));
    expect(screen.getByRole("note")).toHaveTextContent(
      "Look at the reserve readout.",
    );
    expect(screen.getByRole("button", { name: "Hide hint" })).toHaveFocus();
  });

  it("outlines guided targets but never points out a capstone answer", () => {
    const target = document.createElement("button");
    target.id = "tutorial-target";
    document.body.appendChild(target);

    const hudProps = props();
    const { rerender, unmount } = render(<TutorialHud {...hudProps} />);
    expect(target).toHaveClass("tutorialTarget");

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
  });
});
