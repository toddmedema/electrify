import { render, screen, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import type { CompanyResultType } from "../Types";
import type { ObjectiveResult } from "../data/ScenarioObjectives";
import { objectiveDefinition } from "../helpers/ScenarioObjectives";
import * as ObjectiveRules from "../helpers/ObjectiveRules";
import settingsReducer from "../reducers/Settings";
import CoopResult from "./Result";

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
const missing: ObjectiveResult = {
  ...bills,
  objective: { ...bills.objective, id: "missing", required: true },
  id: "missing",
  required: true,
  status: "unverifiable",
  observed: undefined,
  observedMonths: 0,
  reason: "Completed history is unavailable.",
};
function show(results: CompanyResultType[]) {
  const store = configureStore({
    reducer: {
      settings: settingsReducer,
      game: () => ({ startingYear: 2020, multiplayer: { results } }),
    },
  });
  return render(
    <Provider store={store}>
      <CoopResult
        complete
        host={false}
        hostName="Grace"
        selfId="hedy"
        onWatch={jest.fn()}
        onBackToLobby={jest.fn()}
        onLeave={jest.fn()}
      />
    </Provider>,
  );
}
afterEach(() => jest.restoreAllMocks());

test("co-op debriefs display each company's supplied objective verdicts without recomputing them", () => {
  const evaluate = jest
    .spyOn(ObjectiveRules, "gameObjectiveResults")
    .mockImplementation(() => {
      throw new Error("Presentation must not judge objectives");
    });
  show([
    {
      id: "grace",
      name: "Grace",
      outcome: "completed",
      title: "Complete",
      month: 6,
      cash: 1000,
      kgco2e: 1000,
      reliability: 1,
      objectiveResults: [bills],
    },
    {
      id: "hedy",
      name: "Hedy",
      outcome: "fired",
      title: "Evidence unavailable",
      month: 2,
      cash: 2000,
      kgco2e: 2000,
      reliability: 1,
      objectiveResults: [missing],
    },
  ]);
  const grace = screen.getByRole("region", { name: "Grace objective results" });
  const hedy = screen.getByRole("region", { name: "Hedy objective results" });
  expect(grace).toHaveTextContent("Keep bills affordable · Optional · Failed");
  expect(grace).toHaveTextContent("$0.10000000000001/kWh");
  expect(grace).toHaveTextContent(bills.definition);
  expect(grace).toHaveTextContent("Jan–Feb 2020");
  expect(grace).toHaveTextContent(bills.reason!);
  expect(grace).not.toHaveTextContent("Unavailable");
  expect(hedy).toHaveTextContent(
    "Keep bills affordable · Required · Unavailable",
  );
  expect(hedy).toHaveTextContent(
    "0/2 months completed · history incomplete, not verifiable",
  );
  expect(hedy).toHaveTextContent(missing.reason!);
  expect(hedy).toHaveTextContent("Jan–Feb 2020");
  expect(
    within(screen.getByRole("region", { name: "Company results" })).getByRole(
      "row",
      { name: /Hedy \(you\)/ },
    ),
  ).toHaveTextContent("Fired in month 2");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Waiting for Grace to choose the next game.",
  );
  expect(evaluate).not.toHaveBeenCalled();
});
