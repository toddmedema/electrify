import * as React from "react";
import { render, screen } from "@testing-library/react";
import VictoryConditions from "./VictoryConditions";

it("shows the absolute data-center customer threshold beside retention", () => {
  render(
    <VictoryConditions
      ownership="Public"
      dollarsPerkWh={0.1}
      minimumCustomerRetention={0.9}
      startingCustomers={16500}
    />,
  );
  expect(screen.getByText(/Required: retain/)).toHaveTextContent(
    "90% of starting customers (at least 14,850 customers, from 16,500 at the start)",
  );
});

it("makes the CEO meaningful-decision gate visible with live progress", () => {
  render(
    <VictoryConditions
      ownership="Public"
      dollarsPerkWh={0.1}
      difficulty="CEO"
      meaningfulDecisionCount={4}
    />,
  );
  expect(screen.getByTestId("ceo-decision-progress")).toHaveTextContent(
    "Progress: 4 of 10",
  );
});

it("does not add the CEO gate to lower difficulties", () => {
  render(
    <VictoryConditions
      ownership="Public"
      dollarsPerkWh={0.1}
      difficulty="VP"
      meaningfulDecisionCount={9}
    />,
  );
  expect(screen.queryByTestId("ceo-decision-progress")).not.toBeInTheDocument();
});
