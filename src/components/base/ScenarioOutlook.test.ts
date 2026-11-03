import { createGame } from "../../testing/Simulator";
import { activeScenario } from "../../helpers/GameSelectors";
import { selectProjection } from "../../helpers/Projection";
import { scenarioScoreProjection } from "./ScenarioOutlook";

it("keeps the initial score at zero and places every estimated month in the projected series", () => {
  const game = createGame({ scenarioId: 111 });
  const forecast = selectProjection(game, game.timeline[0]);
  const order = forecast.financeProjected.map((row) => [row.year, row.month]);
  const score = scenarioScoreProjection(game, activeScenario(game)!, forecast)!;
  expect(score.actual).toEqual([0]);
  expect(score.projected).toHaveLength(activeScenario(game)!.durationMonths);
  expect(score.projected.every(Number.isFinite)).toBe(true);
  expect(score.projected.some((value) => value !== 0)).toBe(true);
  expect(forecast.financeProjected.map((row) => [row.year, row.month])).toEqual(
    order,
  );
});
