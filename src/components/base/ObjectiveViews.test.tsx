import { render, screen, within } from "@testing-library/react";
import type { ObjectiveResult } from "../../data/ScenarioObjectives";
import { objectiveDefinition } from "../../helpers/ScenarioObjectives";
import * as ObjectiveRules from "../../helpers/ObjectiveRules";
import { getMissionStatus } from "../../helpers/MissionStatus";
import { createGame } from "../../testing/Simulator";
import { activeScenario } from "../../helpers/GameSelectors";
import { ScenarioDetailsContent } from "./ScenarioDetails";
import { RunDebrief } from "./RunResult";
import VictoryDialog from "./VictoryDialog";
import VictoryConditions from "./VictoryConditions";
import SavedResultDialog from "./SavedResultDialog";
import type { VictoryType } from "../../Types";
import { getScenario } from "../../data/Scenarios";
import { objectiveGoalText } from "../../helpers/ObjectivePresentation";

const bills: ObjectiveResult = {
  objective: {
    id: "bills",
    label: "Keep bills affordable",
    required: false,
    metric: "monthlyBilledRate",
    fromMonth: 0,
    throughMonth: 1,
    maxDollarsPerKWh: 0.1,
  },
  id: "bills",
  label: "Keep bills affordable",
  required: false,
  metric: "monthlyBilledRate",
  definition: objectiveDefinition("monthlyBilledRate"),
  status: "failed",
  observed: 0.10000000000001,
  target: 0.1,
  observedMonths: 1,
  requiredMonths: 2,
  reason: "A completed month's billed customer rate exceeded the ceiling.",
};

afterEach(() => jest.restoreAllMocks());

it("shows the owning verdict and Optional meaning in Mission Status without substituting current tariff data", () => {
  const game = createGame({ scenarioId: 103 });
  jest.spyOn(ObjectiveRules, "gameObjectiveResults").mockReturnValue([bills]);
  const mission = getMissionStatus(game);
  expect(mission.requirements.find((row) => row.id === "bills")).toMatchObject({
    status: "failed",
    required: false,
    reason: bills.reason,
  });
  expect(mission.prominent?.id).not.toBe("bills");
  render(
    <ScenarioDetailsContent game={game} scenario={activeScenario(game)!} />,
  );
  const rules = screen.getByRole("region", { name: "Goals" });
  expect(within(rules).getByText("Keep bills affordable")).toBeInTheDocument();
  expect(within(rules).getByText("Optional")).toBeInTheDocument();
  expect(rules).toHaveTextContent("Bills ≤10¢/kWh each month");
  expect(within(rules).queryByText(bills.definition)).not.toBeInTheDocument();
  expect(within(rules).queryByText(bills.reason!)).not.toBeInTheDocument();
  expect(rules).not.toHaveTextContent(/Highest|months completed|Recorded:/);
});

it("renders stored objective debrief facts and unavailability without re-evaluating the finished game", () => {
  const unavailable: ObjectiveResult = {
    ...bills,
    objective: { ...bills.objective, id: "unknown" },
    id: "unknown",
    label: bills.label,
    status: "unverifiable",
    observed: undefined,
    observedMonths: 0,
    reason: "Completed history is unavailable.",
  };
  render(
    <RunDebrief
      outcome="fired"
      debrief={{
        startingFleet: [],
        finalFleet: [],
        startingCash: 0,
        finalCash: 0,
        finalCustomers: 0,
        reliability: 1,
        unservedWh: 0,
        kgco2e: 0,
        highlights: [],
        objectiveResults: [bills, unavailable],
      }}
    />,
  );
  const region = screen.getByRole("region", { name: "Objective results" });
  expect(region).toHaveTextContent("Keep bills affordable · Optional · Failed");
  expect(region).toHaveTextContent(
    "Keep bills affordable · Optional · Unavailable",
  );
  expect(region).toHaveTextContent(
    "0/2 months completed · history incomplete, not verifiable",
  );
  expect(region).toHaveTextContent(bills.definition);
  expect(region).toHaveTextContent("Months 1–2");
  expect(region).toHaveTextContent("10¢/kWh (above goal)");
});

it("dates a built-in scenario's objectives and doesn't repeat the ending already stated", () => {
  const scenario = getScenario(100)!;
  render(
    <RunDebrief
      outcome="fired"
      scenarioId={100}
      leadMessage={`You were fired. ${bills.reason}`}
      debrief={{
        startingFleet: [],
        finalFleet: [],
        startingCash: 0,
        finalCash: 0,
        finalCustomers: 0,
        reliability: 1,
        unservedWh: 0,
        kgco2e: 0,
        highlights: [],
        objectiveResults: [bills],
      }}
    />,
  );
  const region = screen.getByRole("region", { name: "Objective results" });
  expect(region).toHaveTextContent(
    objectiveGoalText(
      bills.objective,
      scenario.startingYear,
      scenario.durationMonths,
      (scenario.startingMonth ?? 1) - 1,
    ),
  );
  expect(region).not.toHaveTextContent(/Months? \d/);
  expect(region).not.toHaveTextContent(bills.reason!);
});

it("keeps each objective's reason when several objectives share the debrief", () => {
  const other: ObjectiveResult = {
    ...bills,
    id: "other",
    label: "Limit bills",
  };
  render(
    <RunDebrief
      outcome="fired"
      leadMessage={`You were fired. ${bills.reason}`}
      debrief={{
        startingFleet: [],
        finalFleet: [],
        startingCash: 0,
        finalCash: 0,
        finalCustomers: 0,
        reliability: 1,
        unservedWh: 0,
        kgco2e: 0,
        highlights: [],
        objectiveResults: [bills, other],
      }}
    />,
  );
  const region = screen.getByRole("region", { name: "Objective results" });
  expect(within(region).getAllByText(bills.reason!)).toHaveLength(2);
});

for (const view of ["live", "saved"] as const) {
  it.each(["completed", "fired", "bankrupt"] as const)(
    `${view} results show objectives only when the mission failed (%s)`,
    (outcome) => {
      const result: VictoryType & { outcome: typeof outcome } = {
        scenarioId: 100,
        scenarioName: "Carbon Fee",
        difficulty: "CEO",
        score: 812,
        breakdown: { supply: 812 },
        ranked: false,
        outcome,
        debrief: {
          startingFleet: [],
          finalFleet: [],
          startingCash: 0,
          finalCash: 0,
          finalCustomers: 0,
          reliability: 1,
          unservedWh: 0,
          kgco2e: 0,
          highlights: [],
          objectiveResults: [bills],
        },
      };
      render(
        view === "saved" ? (
          <SavedResultDialog result={result} onClose={() => undefined} />
        ) : (
          <VictoryDialog
            victory={result}
            loggedIn={false}
            onClose={() => undefined}
            onQuit={() => undefined}
            onRetry={() => undefined}
            onShared={() => undefined}
            onShareFailed={() => undefined}
          />
        ),
      );
      expect(
        screen.getByRole("region", { name: "Mission results" }),
      ).toBeVisible();
      expect(
        screen.queryAllByRole("region", { name: "Objective results" }),
      ).toHaveLength(outcome === "completed" ? 0 : 1);
    },
  );
}

it("shows the same combined retirement goal before starting Across the Valley", () => {
  render(
    <VictoryConditions scenario={getScenario(116)!} difficulty="Employee" />,
  );
  const requirements = screen.getByRole("region", { name: "Requirements" });
  expect(
    within(requirements).getAllByText("Retire original oil plants"),
  ).toHaveLength(1);
  expect(requirements).toHaveTextContent("Champlain’s Oil A by Dec 2020");
  expect(requirements).toHaveTextContent(
    "Acquired original oil plants by Dec 2023",
  );
  expect(requirements).not.toHaveTextContent(
    "Retire acquired original oil assets",
  );
});
