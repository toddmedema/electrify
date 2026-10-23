import * as React from "react";
import { render, screen } from "@testing-library/react";
import VictoryConditions from "./VictoryConditions";
import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../../data/Scenarios";
import { modScenario } from "../../mods/ModScenario";
import { objectiveDefinition } from "../../helpers/ScenarioObjectives";

it.each(["Public", "Investor"] as const)(
  "shows canonical required retention and reliability objectives for %s ownership",
  (ownership) => {
    render(
      <VictoryConditions
        scenario={{
          ...SCENARIOS.find((scenario) => scenario.id === 100)!,
          id: CUSTOM_SCENARIO_ID,
          ownership,
          durationMonths: 72,
          startingYear: 2020,
          minimumCustomerRetention: 0.9,
          startingCustomers: 16500,
          reliabilityObjective: {
            year: 2025,
            month: 1,
            minimumDemandServed: 0.99,
            label: "winter emergency",
            durationMonths: 2,
          },
        }}
        difficulty="Manager"
      />,
    );
    expect(
      screen.getByText(/Retain ≥90% of starting customers/),
    ).toBeInTheDocument();
    expect(screen.getByText(/≥99% of demand monthly/)).toHaveTextContent(
      "Jan–Feb 2025",
    );
    expect(
      screen.getByText(objectiveDefinition("monthlyReliability")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(objectiveDefinition("customerRetention")),
    ).toBeInTheDocument();
  },
);

it("labels optional goals and explains their actual units without making them a win gate", () => {
  const scenario = modScenario({
    schemaVersion: 1,
    gameApi: 1,
    id: "optional-goals",
    title: "Optional goals",
    creator: "Creator",
    version: "1",
    description: "Optional planning practice.",
    seed: 42,
    baseScenarioId: 999,
    officialArcs: [],
    scenario: { durationMonths: 6 },
    objectives: [
      {
        id: "bills",
        label: "Affordable practice",
        metric: "monthlyBilledRate",
        fromMonth: 1,
        throughMonth: 2,
        maxDollarsPerKWh: 0.123456789,
        required: false,
      },
    ],
  });
  render(<VictoryConditions scenario={scenario} difficulty="Manager" />);
  expect(screen.getByText("Optional: Affordable practice")).toBeInTheDocument();
  expect(
    screen.getByText(objectiveDefinition("monthlyBilledRate")),
  ).toBeInTheDocument();
  expect(screen.getByText(/Bills ≤\$0.123456789\/kWh/)).toBeInTheDocument();
  expect(
    screen.getByText("Stretch goal; does not end or fail the run."),
  ).toBeInTheDocument();
});

it("keeps internal decision tracking out of player victory conditions", () => {
  render(
    <VictoryConditions
      scenario={SCENARIOS.find((scenario) => scenario.id === 100)!}
      difficulty="Manager"
    />,
  );
  expect(
    screen.queryByTestId("meaningful-decision-progress"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("meaningful-decision-history"),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/In all scenarios, you fail/)).toHaveTextContent(
    "In all scenarios, you fail if you go bankrupt or serve less than 90% of demand in three consecutive months.",
  );
});

it("explains the stricter Expert blackout limit", () => {
  render(
    <VictoryConditions
      scenario={SCENARIOS.find((scenario) => scenario.id === 100)!}
      difficulty="CEO"
    />,
  );
  expect(screen.getByText(/In all scenarios, you fail/)).toHaveTextContent(
    "serve less than 95% of demand in three consecutive months",
  );
});
