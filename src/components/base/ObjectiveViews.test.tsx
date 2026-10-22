import { render, screen, within } from "@testing-library/react";
import type { ObjectiveResult } from "../../data/ScenarioObjectives";
import { objectiveDefinition } from "../../helpers/ScenarioObjectives";
import * as ObjectiveRules from "../../helpers/ObjectiveRules";
import { getMissionStatus } from "../../helpers/MissionStatus";
import { createGame } from "../../testing/Simulator";
import { activeScenario } from "../../helpers/GameSelectors";
import { ScenarioDetailsContent } from "./ScenarioDetails";
import { RunDebrief } from "./RunResult";

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
  const rules = screen.getByRole("region", { name: "Victory conditions" });
  expect(within(rules).getByText("Keep bills affordable")).toBeInTheDocument();
  expect(within(rules).getByText("Optional")).toBeInTheDocument();
  expect(within(rules).getByText(bills.definition)).toBeInTheDocument();
  expect(within(rules).getByText(bills.reason!)).toBeInTheDocument();
  expect(
    within(rules).getByText(/Highest \$0.10000000000001\/kWh/),
  ).toBeInTheDocument();
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
  expect(region).toHaveTextContent(
    "$0.10000000000001/kWh in starting-year dollars",
  );
});
