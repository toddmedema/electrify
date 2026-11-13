import { render, screen } from "@testing-library/react";
import { RunDebrief } from "./RunResult";

it.each([
  [0.99999, 1, "<100%"],
  [1, 0, "100%"],
  [0.998, 200, "99.8%"],
])(
  "qualifies rounded imperfect reliability %s",
  (reliability, unservedWh, label) => {
    render(
      <RunDebrief
        outcome="completed"
        debrief={{
          startingFleet: [],
          finalFleet: [],
          startingCash: 0,
          finalCash: 0,
          finalCustomers: 0,
          reliability,
          unservedWh,
          kgco2e: 0,
          highlights: [],
        }}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Mission results" }),
    ).toHaveTextContent(`${label}served`);
    expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
  },
);
