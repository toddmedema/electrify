import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import DifficultyPicker, { DIFFICULTY_DESCRIPTIONS } from "./DifficultyPicker";
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  DIFFICULTY_LABELS,
  difficultyLabel,
} from "../../Constants";

describe("difficulty constants", () => {
  it("lists every difficulty in the order DIFFICULTIES defines them", () => {
    expect(DIFFICULTY_IDS).toEqual(Object.keys(DIFFICULTIES));
  });

  it("labels known IDs and passes unknown leaderboard values through", () => {
    expect(difficultyLabel("VP")).toBe("Hard");
    expect(difficultyLabel("Wizard")).toBe("Wizard");
  });
});

describe("DifficultyPicker", () => {
  it("offers each difficulty as a toggle with the chosen description", () => {
    const onChange = jest.fn();
    render(
      <DifficultyPicker
        variant="toggle"
        showDescription
        value="Manager"
        onChange={onChange}
      />,
    );
    expect(
      screen.getByText(
        `${DIFFICULTY_DESCRIPTIONS.Manager} Serving less than 97% of demand for 3 months in a row ends the run.`,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText(DIFFICULTY_LABELS.Manager));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(DIFFICULTY_LABELS.CEO));
    expect(onChange).toHaveBeenCalledWith("CEO");
  });

  it("shows the player-facing label in the select", () => {
    render(
      <DifficultyPicker
        variant="select"
        value="VP"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText("Hard")).toBeInTheDocument();
    expect(screen.queryByText("VP")).not.toBeInTheDocument();
  });

  it("exposes each selectable option by its visible difficulty label", () => {
    const onChange = jest.fn();
    render(
      <DifficultyPicker
        variant="select"
        value="Employee"
        onChange={onChange}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Difficulty" }));
    fireEvent.click(screen.getByRole("option", { name: "Medium" }));
    expect(onChange).toHaveBeenCalledWith("Manager");
  });
});

it("explains tapped and focused locks without selecting them, then reacts to an unlock", () => {
  const onChange = jest.fn();
  const { rerender } = render(
    <DifficultyPicker
      variant="toggle"
      value="Intern"
      unlockedThrough="Intern"
      onChange={onChange}
    />,
  );
  const expert = screen.getByRole("button", { name: "Expert, locked" });
  expect(expert).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(expert);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "on Hard to unlock Expert",
  );
  expect(screen.getByRole("button", { name: "Beginner" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.focus(screen.getByRole("button", { name: "Medium, locked" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "on Easy to unlock Medium",
  );
  rerender(
    <DifficultyPicker
      variant="toggle"
      value="Intern"
      unlockedThrough="Employee"
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Easy" }));
  expect(onChange).toHaveBeenCalledWith("Employee");
});

it("keeps a locked select option from changing difficulty and explains its requirement", () => {
  const onChange = jest.fn();
  render(
    <DifficultyPicker
      variant="select"
      value="Intern"
      unlockedThrough="Intern"
      onChange={onChange}
    />,
  );
  fireEvent.mouseDown(screen.getByRole("combobox"));
  const expert = screen.getByRole("option", { name: "Expert, locked" });
  expect(expert).toHaveTextContent("on Hard to unlock Expert");
  expect(expert).toHaveAccessibleDescription(
    "Complete an official non-tutorial scenario on Hard to unlock Expert.",
  );
  fireEvent.click(expert);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "on Hard to unlock Expert",
  );
});

it("shows the host's read-only choice without claiming the guest must unlock it", () => {
  render(
    <DifficultyPicker
      variant="toggle"
      value="CEO"
      unlockedThrough="Intern"
      readOnly
      onChange={jest.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Expert" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Expert" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
