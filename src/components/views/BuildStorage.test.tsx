import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { createGame } from "../../testing/Simulator";
import { GameType } from "../../Types";
import BuildStorage from "./BuildStorage";

jest.mock("../base/ManualLink", () => () => null);

function game(): GameType {
  const state = createGame({ scenarioId: 103 });
  return {
    ...state,
    location: {
      id: "Reykjavik",
      name: "Reykjavik, Iceland",
      lat: 64.1466,
      long: -21.9426,
      country: "Iceland",
      region: "Europe",
    },
  };
}

it("shows remaining pumped-hydro locations in the expanded build view", () => {
  render(
    <BuildStorage
      game={game()}
      onBuildStorage={jest.fn()}
      onBack={jest.fn()}
      onSpeedChange={jest.fn()}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Show Pumped Hydro details" }),
  );

  const row = screen.getByRole("row", {
    name: /Number of viable locations remaining.*648/,
  });
  expect(row).toHaveTextContent("648");
  expect(row).toHaveTextContent("Each project uses one suitable site");
});
