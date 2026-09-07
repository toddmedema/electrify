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
