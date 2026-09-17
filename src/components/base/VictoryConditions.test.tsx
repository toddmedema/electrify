import * as React from "react";
import { render, screen } from "@testing-library/react";
import VictoryConditions from "./VictoryConditions";
import { MeaningfulDecisionType } from "../../Types";

const decisions: MeaningfulDecisionType[] = [
  {
    key: "rate",
    lever: "rate",
    label: "Set the customer electricity rate",
    month: 0,
    kind: "rate",
    before: "0.1",
    after: "0.11",
  },
  {
    key: "policy:solar",
    lever: "policy:solar",
    label: "Fund rooftop solar rebates",
    month: 1,
    kind: "policy",
    before: "Off",
    after: "Small",
  },
  {
    key: "dispatch:1",
    lever: "dispatch:1",
    label: "Set Coal dispatch priority",
    month: 2,
    kind: "dispatch",
    before: "0",
    after: "1",
  },
  {
    key: "asset-build:3",
    lever: "asset-build:3",
    label: "Build Natural Gas (100MW)",
    month: 3,
    kind: "asset",
    before: "absent",
    after: "Natural Gas:100000000:financed",
  },
];

it.each(["Public", "Investor"] as const)(
  "shows required retention and reliability objectives for %s ownership",
  (ownership) => {
    render(
      <VictoryConditions
        ownership={ownership}
        dollarsPerkWh={0.1}
        minimumCustomerRetention={0.9}
        startingCustomers={16500}
        reliabilityObjective={{
          year: 2025,
          month: 1,
          minimumDemandServed: 0.99,
          label: "winter emergency",
          durationMonths: 2,
        }}
      />,
    );
    expect(screen.getByText(/Required: retain/)).toHaveTextContent(
      "90% of starting customers (at least 14,850 customers, from 16,500 at the start)",
    );
    expect(screen.getByText(/Required: serve/)).toHaveTextContent(
      "99% of demand during the winter emergency in every event month",
    );
  },
);

it("makes the CEO meaningful-decision gate visible with live progress", () => {
  render(
    <VictoryConditions
      ownership="Public"
      dollarsPerkWh={0.1}
      difficulty="CEO"
      meaningfulDecisions={decisions}
    />,
  );
  expect(screen.getByTestId("meaningful-decision-progress")).toHaveTextContent(
    "Progress: 4 of 10 choices · 4 of 4 types",
  );
  expect(screen.getByTestId("meaningful-decision-history")).toHaveTextContent(
    "Build Natural Gas (100MW) — grid investments",
  );
});

it("does not add the CEO gate to lower difficulties", () => {
  render(
    <VictoryConditions
      ownership="Public"
      dollarsPerkWh={0.1}
      difficulty="VP"
      meaningfulDecisions={decisions}
    />,
  );
  expect(
    screen.queryByTestId("meaningful-decision-progress"),
  ).not.toBeInTheDocument();
});

it("shows the one-decision Intern objective and legacy waiver", () => {
  const { rerender } = render(
    <VictoryConditions
      ownership="Public"
      dollarsPerkWh={0.1}
      difficulty="Intern"
      meaningfulDecisions={[]}
    />,
  );
  expect(screen.getByTestId("meaningful-decision-progress")).toHaveTextContent(
    "Progress: 0 of 1",
  );

  rerender(
    <VictoryConditions
      ownership="Public"
      dollarsPerkWh={0.1}
      difficulty="Intern"
      meaningfulDecisions={[]}
      meaningfulDecisionGateWaived
    />,
  );
  expect(screen.getByText(/original victory rules still apply/i)).toBeVisible();
});
