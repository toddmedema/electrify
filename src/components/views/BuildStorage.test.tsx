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

it("keeps toolbar actions inside compact viewport gutters", () => {
  render(
    <BuildStorage
      game={game()}
      onBuildStorage={jest.fn()}
      onBack={jest.fn()}
      onSpeedChange={jest.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "close" })).not.toHaveClass(
    "MuiIconButton-edgeEnd",
  );
  expect(screen.getByRole("button", { name: "sort" })).not.toHaveClass(
    "MuiIconButton-edgeEnd",
  );
});

it("submits a storage purchase only once on a double-click", () => {
  const onBuildStorage = jest.fn();
  render(
    <BuildStorage
      game={game()}
      onBuildStorage={onBuildStorage}
      onBack={jest.fn()}
      onSpeedChange={jest.fn()}
    />,
  );

  // Pumped Hydro is the first shopping card, so its price is the first purchase button.
  fireEvent.click(screen.getAllByRole("button", { name: /^\$/ })[0]);
  const takeLoan = screen.getByRole("button", { name: "Take loan" });
  fireEvent.click(takeLoan);
  fireEvent.click(takeLoan);

  expect(onBuildStorage).toHaveBeenCalledTimes(1);
});
