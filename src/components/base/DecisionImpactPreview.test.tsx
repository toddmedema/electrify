import * as React from "react";
import { render, screen } from "@testing-library/react";
import DecisionImpactPreview from "./DecisionImpactPreview";

it("keeps an exact delta beside its explanation", () => {
  render(
    <DecisionImpactPreview
      facts={[
        {
          concept: "money",
          label: "Cash purchase",
          value: "$330M → $179M",
          detail: "A loan uses a smaller down payment.",
        },
      ]}
    />,
  );

  expect(
    screen.getByRole("region", { name: "Expected impact" }),
  ).toHaveTextContent("$330M → $179M");
  expect(screen.getByText(/smaller down payment/)).toBeInTheDocument();
});
