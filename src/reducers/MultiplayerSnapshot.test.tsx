import cloneDeep from "lodash.clonedeep";
import gameReducer, { tickState } from "./Game";
import { multiplayerSnapshot } from "./GameActions";
import { createGame } from "../testing/Simulator";

test("live multiplayer ticks retain completed history and location so normal forecasts can finish", () => {
  const game = createGame({ scenarioId: 101, seed: 12345 });
  while (game.date.monthsElapsed < 1) tickState(game);
  game.multiplayer = { seat: "host" };
  const initial = gameReducer(undefined, multiplayerSnapshot(game));
  const tick = cloneDeep(initial);
  tick.date.minute++;
  tick.dollarsPerkWh = 0.15;
  const updated = gameReducer(initial, multiplayerSnapshot(tick));
  expect(updated.monthlyHistory).toBe(initial.monthlyHistory);
  expect(updated.location).toBe(initial.location);
  expect(updated.date.minute).toBe(tick.date.minute);
  expect(updated.dollarsPerkWh).toBe(0.15);

  const month = cloneDeep(updated);
  month.date.monthsElapsed++;
  month.monthlyHistory.unshift(cloneDeep(month.monthlyHistory[0]));
  const rollover = gameReducer(updated, multiplayerSnapshot(month));
  expect(rollover.monthlyHistory).not.toBe(updated.monthlyHistory);
  expect(rollover.monthlyHistory).toEqual(month.monthlyHistory);
  expect(rollover.location).toBe(updated.location);

  const anotherGrid = cloneDeep(updated);
  anotherGrid.multiplayer!.seat = "guest";
  const switched = gameReducer(updated, multiplayerSnapshot(anotherGrid));
  expect(switched.monthlyHistory).not.toBe(updated.monthlyHistory);
  expect(switched.location).not.toBe(updated.location);
});
