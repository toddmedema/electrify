import * as React from "react";
import { render, screen } from "@testing-library/react";
import VictoryConditions from "./VictoryConditions";

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

it("keeps internal decision tracking out of player victory conditions", () => {
  render(<VictoryConditions ownership="Public" dollarsPerkWh={0.1} />);
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
