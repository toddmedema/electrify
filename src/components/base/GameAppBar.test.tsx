import * as React from "react";
import { render, screen } from "@testing-library/react";
import { GameAppBar } from "./GameAppBar";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { createGame } from "../../testing/Simulator";

function renderBar(blackout = false) {
  const game = createGame({ scenarioId: 100 });
  game.inGame = true;
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  if (!now) {
    throw new Error("Test game has no current timeline entry");
  }
  if (blackout) {
    now.supplyW = now.demandW / 2;
  }

  render(
    <GameAppBar
      game={game}
      onManual={() => undefined}
      onSettings={() => undefined}
      onSpeedChange={() => undefined}
      onNextTutorial={() => undefined}
      onQuit={() => undefined}
    />,
  );
}

describe("the operating status strip", () => {
  it("reports supply, demand, and the current margin", () => {
    renderBar();

    expect(screen.getByText("Supply")).toBeInTheDocument();
    expect(screen.getByText("Demand")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAccessibleName(
      /grid operating with a .* percent supply margin/i,
    );
  });

  it("turns a shortfall into an explicit blackout warning", () => {
    renderBar(true);

    expect(screen.getByRole("status")).toHaveAccessibleName(
      /blackout: supply is .* short of demand/i,
    );
    expect(screen.getByText(/short$/)).toBeInTheDocument();
  });
});
