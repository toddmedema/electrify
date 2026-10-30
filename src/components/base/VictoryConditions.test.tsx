import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import VictoryConditions from "./VictoryConditions";
import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../../data/Scenarios";
import { modScenario } from "../../mods/ModScenario";
import { objectiveDefinition } from "../../helpers/ScenarioObjectives";

it("separates requirements from points and keeps measurement help secondary", () => {
  render(
    <VictoryConditions
      scenario={SCENARIOS.find((scenario) => scenario.id === 100)!}
      difficulty="Manager"
    />,
  );
  const requirements = screen.getByRole("region", { name: "Requirements" });
  const scoring = screen.getByRole("region", { name: "Scoring" });
  expect(within(requirements).getByText(/bankruptcy/i)).toBeInTheDocument();
  expect(within(requirements).queryByText(/Earn .*points/)).toBeNull();
  expect(within(scoring).getByText(/Service/)).toBeInTheDocument();
  expect(
    within(scoring).getByText(/Financial performance/),
  ).toBeInTheDocument();
  expect(within(scoring).getByText(/Environmental impact/)).toBeInTheDocument();
  expect(screen.getByText("How objectives are measured")).toBeVisible();
  expect(
    screen.getByText(objectiveDefinition("customerRetention")),
  ).not.toBeVisible();
});

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
      screen.getByText(/Keep ≥90% of starting customers/),
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
  const optional = screen.getByRole("region", { name: "Optional goals" });
  expect(within(optional).getByText("Affordable practice")).toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Requirements" })).queryByText(
      "Affordable practice",
    ),
  ).toBeNull();
  expect(
    screen.getByText(objectiveDefinition("monthlyBilledRate")),
  ).toBeInTheDocument();
  expect(screen.getByText(/Bills ≤\$0.123456789\/kWh/)).toBeInTheDocument();
  expect(
    screen.getByText("Stretch goals; not required to win."),
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
  expect(screen.getByText(/Serve at least/)).toHaveTextContent(
    "Serve at least 90% of demand. Three consecutive months below this end the run.",
  );
});

it("explains the stricter Expert blackout limit", () => {
  render(
    <VictoryConditions
      scenario={SCENARIOS.find((scenario) => scenario.id === 100)!}
      difficulty="CEO"
    />,
  );
  expect(screen.getByText(/Serve at least/)).toHaveTextContent(
    "Serve at least 95% of demand. Three consecutive months below this end the run.",
  );
});
