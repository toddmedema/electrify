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

function challengeRows(): HTMLElement[] {
  return within(screen.getByTestId("challenge-list")).getAllByTestId(
    /^mission-row-/,
  );
}

describe("NewGame", () => {
  beforeEach(() => localStorage.clear());

  it("starts with one next lesson and three varied challenge recommendations", () => {
    render(<NewGame {...props()} />);

    expect(
      screen.getByTestId(`tutorial-spotlight-${TUTORIALS[0].id}`),
    ).toHaveTextContent("Continue learning · 0 of 6 complete");
    expect(screen.queryByTestId(`mission-row-${TUTORIALS[0].id}`)).toBeNull();
    expect(challengeRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("Deep Freeze"),
      expect.stringContaining("Data Center Boom"),
      expect.stringContaining("Carbon Fee"),
    ]);
    expect(screen.getByRole("button", { name: "For you" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByLabelText("Deep Freeze themes")).toBeNull();
    expect(screen.getByRole("button", { name: "View all 6" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.getByTestId(`mission-row-${CUSTOM_SCENARIO_ID}`),
    ).toHaveTextContent("Custom Game");
  });

  it("expands tutorials in authored order and shows all challenges by latest timeframe", () => {
    render(<NewGame {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: "View all 6" }));
    const tutorialCatalog = screen.getByRole("group", {
      name: "All tutorials",
    });
    const tutorialRows =
      within(tutorialCatalog).getAllByTestId(/^mission-row-/);
    TUTORIALS.forEach((tutorial, index) =>
      expect(tutorialRows[index]).toHaveTextContent(
        tutorial.name.replace(/^Mission \d+:\s*/, ""),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "All challenges" }));
    const scenariosNewestFirst = SCENARIOS.filter(
      (scenario) => !scenario.tutorialSteps,
    ).sort(
      (a, b) =>
        b.startingYear - a.startingYear ||
        b.startingYear +
          Math.ceil(b.durationMonths / 12) -
          1 -
          (a.startingYear + Math.ceil(a.durationMonths / 12) - 1),
    );
    const rows = challengeRows();
    expect(rows).toHaveLength(scenariosNewestFirst.length);
    scenariosNewestFirst.forEach((scenario, index) =>
      expect(rows[index]).toHaveTextContent(scenario.name),
    );
  });

  it("filters the full challenge catalog by player-facing themes", () => {
    render(<NewGame {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: "Extreme weather" }));
    expect(challengeRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("Heatwave + Drought"),
      expect.stringContaining("Wildfire Emergency"),
      expect.stringContaining("Deep Freeze"),
      expect.stringContaining("Hurricane Season"),
    ]);
    expect(screen.getByLabelText("Deep Freeze themes")).toHaveTextContent(
      "Extreme weather",
    );

    fireEvent.click(screen.getByRole("button", { name: "Energy transition" }));
    expect(screen.getByTestId("mission-row-105")).toHaveTextContent("Paradise");
    expect(screen.queryByTestId("mission-row-104")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "For you" }));
    expect(challengeRows()).toHaveLength(3);
    expect(screen.queryByLabelText("Deep Freeze themes")).toBeNull();
  });

  it("moves completed recommendations behind unplayed challenges", () => {
    recordPlayed(107);
    render(<NewGame {...props()} />);

    expect(challengeRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("Data Center Boom"),
      expect.stringContaining("Carbon Fee"),
      expect.stringContaining("Sudden Nuclear Shutdown"),
    ]);
  });

  it("fills fewer than three unplayed recommendations with the most-played challenge", () => {
    const challenges = SCENARIOS.filter((scenario) => !scenario.tutorialSteps);
    const unplayedNames = new Set(["Deep Freeze", "Data Center Boom"]);
    const playedIds = challenges
      .filter((scenario) => !unplayedNames.has(scenario.name))
      .map((scenario) => scenario.id);
    const paradiseId = challenges.find(
      (scenario) => scenario.name === "Paradise",
    )!.id;
    recordPlayed(...playedIds, paradiseId, paradiseId, paradiseId);

    render(<NewGame {...props()} />);

    expect(challengeRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("Deep Freeze"),
      expect.stringContaining("Data Center Boom"),
      expect.stringContaining("Paradise"),
    ]);
  });

  it("recommends the most-played challenges after every challenge has been played", () => {
    const challenges = SCENARIOS.filter((scenario) => !scenario.tutorialSteps);
    const dataCenterId = challenges.find(
      (scenario) => scenario.name === "Data Center Boom",
    )!.id;
    const deepFreezeId = challenges.find(
      (scenario) => scenario.name === "Deep Freeze",
    )!.id;
    recordPlayed(
      ...challenges.map((scenario) => scenario.id),
      dataCenterId,
      dataCenterId,
      deepFreezeId,
    );

    render(<NewGame {...props()} />);

    expect(challengeRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("Data Center Boom"),
      expect.stringContaining("Deep Freeze"),
      expect.stringContaining("Carbon Fee"),
    ]);
  });

  it("uses each recommended scenario's dedicated icon", () => {
    render(<NewGame {...props()} />);
    expect(
      screen.getByRole("img", { name: "Carbon Fee icon" }),
    ).toHaveAttribute("src", "/images/carbon fee.svg");
    expect(
      screen.getByRole("img", { name: "Data Center Boom icon" }),
    ).toHaveAttribute("src", "/images/ai data center boom.svg");
    expect(
      screen.getByRole("img", { name: "Deep Freeze icon" }),
    ).toHaveAttribute("src", "/images/texas deep freeze.svg");
  });

  it("shows the inclusive final calendar year for recommendations", () => {
    render(<NewGame {...props()} />);

    expect(screen.getByTestId("mission-row-107")).toHaveTextContent(
      "Austin, TX · 2017–2023",
    );
    expect(screen.getByTestId("mission-row-106")).toHaveTextContent(
      "Manassas, VA · 2020–2035",
    );
  });

  it("turns the first incomplete tutorial into an explicit continuation", () => {
    recordPlayed(TUTORIALS[0].id);
    render(<NewGame {...props()} />);

    const next = screen.getByTestId(`tutorial-spotlight-${TUTORIALS[1].id}`);
    expect(next).toHaveTextContent("Continue learning · 1 of 6 complete");
    expect(next).toHaveTextContent(TUTORIALS[1].summary as string);
    expect(within(next).getByRole("button")).toHaveAccessibleName(
      `Start ${TUTORIALS[1].name.replace(/^Mission \d+:\s*/, "")}`,
    );
  });

  it("shows a completion summary when every tutorial is finished", () => {
    recordPlayed(...TUTORIALS.map((tutorial) => tutorial.id));
    render(<NewGame {...props()} />);

    expect(screen.getByText("Tutorials complete")).toBeInTheDocument();
    expect(screen.queryByTestId(/^tutorial-spotlight-/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View all 6" }));
    expect(
      within(
        screen.getByRole("group", { name: "All tutorials" }),
      ).getAllByTestId(/^mission-complete-/),
    ).toHaveLength(TUTORIALS.length);
  });

  it("shows completion badges in the expanded catalogs", () => {
    const regular = SCENARIOS.find(
      (scenario: ScenarioType) => !scenario.tutorialSteps,
    ) as ScenarioType;
    recordPlayed(TUTORIALS[0].id, regular.id);
    render(<NewGame {...props()} />);

    fireEvent.click(screen.getByRole("button", { name: "View all 6" }));
    fireEvent.click(screen.getByRole("button", { name: "All challenges" }));
    expect(
      screen.getByTestId(`mission-complete-${TUTORIALS[0].id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`mission-complete-${regular.id}`),
    ).toBeInTheDocument();
  });

  it("starts the recommended tutorial and opens challenge and custom details", () => {
    const onTutorial = jest.fn();
    const onDetails = jest.fn();
    const onCustomGame = jest.fn();
    render(<NewGame {...props({ onTutorial, onDetails, onCustomGame })} />);

    fireEvent.click(
      within(
        screen.getByTestId(`tutorial-spotlight-${TUTORIALS[0].id}`),
      ).getByRole("button"),
    );
    expect(onTutorial).toHaveBeenCalledWith(TUTORIALS[0].id);

    fireEvent.click(
      within(screen.getByTestId("mission-row-107")).getByRole("button"),
    );
    expect(onDetails).toHaveBeenCalledWith({ scenarioId: 107 });

    fireEvent.click(
      within(screen.getByTestId(`mission-row-${CUSTOM_SCENARIO_ID}`)).getByRole(
        "button",
      ),
    );
    expect(onCustomGame).toHaveBeenCalled();
  });
});
