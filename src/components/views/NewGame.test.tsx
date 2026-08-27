import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(screen.getByText("Training")).toBeInTheDocument();
    expect(screen.getByText("Scenarios")).toBeInTheDocument();
    expect(screen.getByText("Sandbox")).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Available missions" }),
    ).toContainElement(rows[0]);
  });

  it("highlights the first incomplete tutorial without replacing its subtitle", () => {
    recordPlayed(TUTORIALS[0].id);
    render(<NewGame {...props()} />);

    const next = screen.getByTestId(`mission-row-${TUTORIALS[1].id}`);
    expect(TUTORIALS[1].summary).toBeDefined();
    expect(next).toHaveTextContent(TUTORIALS[1].summary as string);
    expect(next).not.toHaveTextContent("Start here");
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

    fireEvent.click(
      within(screen.getByTestId(`mission-row-${TUTORIALS[0].id}`)).getByRole(
        "button",
      ),
    );
    expect(onTutorial).toHaveBeenCalledWith(TUTORIALS[0].id);

    fireEvent.click(
      within(screen.getByTestId(`mission-row-${regular.id}`)).getByRole(
        "button",
      ),
    );
    expect(onDetails).toHaveBeenCalledWith({ scenarioId: regular.id });

    fireEvent.click(
      within(screen.getByTestId(`mission-row-${CUSTOM_SCENARIO_ID}`)).getByRole(
        "button",
      ),
    );
    expect(onCustomGame).toHaveBeenCalled();
  });
});
