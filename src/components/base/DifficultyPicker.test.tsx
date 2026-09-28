import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import DifficultyPicker from "./DifficultyPicker";
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
      screen.getByText(DIFFICULTIES.Manager.description),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText(DIFFICULTY_LABELS.CEO));
    expect(onChange).toHaveBeenCalledWith("CEO");
  });

  it("ignores deselecting the current toggle", () => {
    const onChange = jest.fn();
    render(
      <DifficultyPicker variant="toggle" value="Manager" onChange={onChange} />,
    );
    fireEvent.click(screen.getByText(DIFFICULTY_LABELS.Manager));
    expect(onChange).not.toHaveBeenCalled();
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
});
