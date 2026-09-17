import * as game from "../reducers/Game";
import { runMonths } from "./SimulationTestHelpers";
import { createGame } from "./Simulator";

afterEach(() => jest.restoreAllMocks());

it("fails promptly if a blocked tick cannot advance the simulation", () => {
  const state = createGame({ scenarioId: 103 });
  const tick = jest.spyOn(game, "tickState").mockImplementation(() => {});
  expect(() => runMonths(state, 1)).toThrow("Simulation stopped advancing");
  expect(tick).toHaveBeenCalledTimes(1);
});

it.each([NaN, Infinity, -1, 0.5])(
  "rejects invalid month count %s",
  (months) => {
    const state = createGame({ scenarioId: 103 });
    expect(() => runMonths(state, months)).toThrow(
      "Simulation months must be a non-negative safe integer",
    );
  },
);

it("advances the requested months and permits a zero-month no-op", () => {
  const state = createGame({ scenarioId: 103 });
  const start = state.date.minute;
  runMonths(state, 0);
  expect(state.date.minute).toBe(start);
  runMonths(state, 1);
  expect(state.date.monthsElapsed).toBe(1);
});
