import * as React from "react";
import { render, screen } from "@testing-library/react";
import { SCENARIOS } from "../../data/Scenarios";
import ScenarioArtwork from "./ScenarioArtwork";

it("turns the authored starting fleet into an accessible postcard", () => {
  const scenario = SCENARIOS.find((candidate) => candidate.id === 100)!;
  render(<ScenarioArtwork scenario={scenario} />);

  expect(
    screen.getByRole("img", {
      name: "Carbon Fee starting grid: Coal, Natural Gas",
    }),
  ).toHaveClass("tone-transition");
});
