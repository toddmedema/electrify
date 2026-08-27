import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { CUSTOM_SCENARIO_ID, SCENARIOS, TUTORIALS } from "../../data/Scenarios";
import { GameType, ScenarioType } from "../../Types";
import NewGame, { Props } from "./NewGame";

function props(overrides: Partial<Props> = {}): Props {
  return {
    game: {} as GameType,
    onBack: jest.fn(),
    onCustomGame: jest.fn(),
    onDetails: jest.fn(),
    onManual: jest.fn(),
    onTutorial: jest.fn(),
    ...overrides,
  };
}

function recordPlayed(...scenarioIds: number[]) {
  localStorage.setItem(
    "plays",
    JSON.stringify({
      plays: scenarioIds.map((scenarioId) => ({
        scenarioId,
        date: "2026-08-27",
      })),
    }),
  );
}

describe("NewGame", () => {
  beforeEach(() => localStorage.clear());

  it("shows every authored mission in order, followed by the custom game", () => {
    render(<NewGame {...props()} />);

    const rows = screen.getAllByTestId(/^mission-row-/);
    expect(rows).toHaveLength(SCENARIOS.length + 1);
    SCENARIOS.forEach((scenario, index) =>
      expect(rows[index]).toHaveTextContent(scenario.name),
    );
    expect(rows[rows.length - 1]).toHaveTextContent("Custom Game");
    expect(screen.queryByText("Tutorials")).not.toBeInTheDocument();
    expect(screen.queryByText("Scenarios")).not.toBeInTheDocument();
  });

  it("marks the first incomplete tutorial as the starting point", () => {
    recordPlayed(TUTORIALS[0].id);
    render(<NewGame {...props()} />);

    const next = screen.getByTestId(`mission-row-${TUTORIALS[1].id}`);
    expect(next).toHaveTextContent("Start here");
    expect(next).toHaveTextContent(TUTORIALS[1].name);
    expect(next).toHaveClass("tutorialNext");
  });

  it("shows completion badges for tutorials and regular missions", () => {
    const regular = SCENARIOS.find(
      (scenario: ScenarioType) => !scenario.tutorialSteps,
    ) as ScenarioType;
    recordPlayed(TUTORIALS[0].id, regular.id);
    render(<NewGame {...props()} />);

    expect(
      screen.getByTestId(`mission-complete-${TUTORIALS[0].id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`mission-complete-${regular.id}`),
    ).toBeInTheDocument();
  });

  it("starts tutorials directly and opens details for regular missions", () => {
    const onTutorial = jest.fn();
    const onDetails = jest.fn();
    const onCustomGame = jest.fn();
    const regular = SCENARIOS.find(
      (scenario: ScenarioType) => !scenario.tutorialSteps,
    ) as ScenarioType;
    render(<NewGame {...props({ onTutorial, onDetails, onCustomGame })} />);

    fireEvent.click(screen.getByTestId(`mission-row-${TUTORIALS[0].id}`));
    expect(onTutorial).toHaveBeenCalledWith(TUTORIALS[0].id);

    fireEvent.click(screen.getByTestId(`mission-row-${regular.id}`));
    expect(onDetails).toHaveBeenCalledWith({ scenarioId: regular.id });

    fireEvent.click(screen.getByTestId(`mission-row-${CUSTOM_SCENARIO_ID}`));
    expect(onCustomGame).toHaveBeenCalled();
  });
});
