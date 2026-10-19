import { render, screen } from "@testing-library/react";
import * as DateTime from "../../helpers/DateTime";
import { createGame } from "../../testing/Simulator";
import { activeScenario } from "../../helpers/GameSelectors";
import { ScenarioDetailsContent } from "./ScenarioDetails";

function renderDetails(game = createGame({ scenarioId: 103 })) {
  return render(
    <ScenarioDetailsContent game={game} scenario={activeScenario(game)!} />,
  );
}

it("waits for a completed month before scoring", () => {
  renderDetails();
  expect(screen.getByText("The Shale Boom")).toBeInTheDocument();
  expect(
    screen.getByText("Score appears after your first month."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Score outlook" })).toBeNull();
  // The tool's top bar already counts down the term
  expect(screen.queryByText(/months remaining/)).toBeNull();
});

it("shows the score so far beside where the current pace ends it", () => {
  const game = createGame({ scenarioId: 103 });
  // Newest first: three months, each supplying 1 TWh and adding $1B of net worth
  const monthlyHistory = [3, 2, 1].map((month) => ({
    ...DateTime.EMPTY_HISTORY,
    deliveredWhByFuel: {},
    year: game.startingYear,
    month,
    supplyWh: 1e12,
    demandWh: 1e12,
    netWorth: 1e9 * month,
  }));
  renderDetails({ ...game, monthlyHistory });
  const outlook = screen.getByRole("region", { name: "Score outlook" });
  expect(outlook).toHaveTextContent("Score now");
  expect(outlook).toHaveTextContent("Projected final");
  expect(
    screen.getByRole("region", { name: "Score breakdown" }),
  ).toHaveTextContent(/electricity supplied/i);
});
