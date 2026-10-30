import cloneDeep from "lodash.clonedeep";
import { forecastWorkerSnapshot } from "../components/base/ForecastWorkerSnapshot";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "../testing/Simulator";
import { loadSimData } from "../testing/SimData";
import {
  generateForecastTimeline,
  generateNewTimeline,
  tickState,
} from "./Game";

it("uses estimated basin weather for rain, runoff and hydro dispatch", () => {
  const game = createGame({ scenarioId: 108, seed: 7 });
  const now = game.timeline[0];
  const actual = generateNewTimeline(
    game,
    now.cash,
    now.customers,
    12 * 24,
    60,
  );
  const forecast = generateForecastTimeline(
    game,
    now.cash,
    now.customers,
    12 * 24,
    60,
  );
  // The hydro balance must be simulated from the estimate, just like wind/solar and demand.
  for (const field of [
    "precipitationMm",
    "hydroRunoffMm",
    "hydroReservoirWh",
  ] as const) {
    expect(forecast.map((tick) => tick[field])).not.toEqual(
      actual.map((tick) => tick[field]),
    );
  }
  expect(forecast.map((tick) => tick.supplyByFuel.Hydro)).not.toEqual(
    actual.map((tick) => tick.supplyByFuel.Hydro),
  );
  expect(
    generateNewTimeline(game, now.cash, now.customers, 12 * 24, 60),
  ).toEqual(actual);
});

it("reproduces an off-hour forecast through save reload and worker snapshots without changing live ticks", () => {
  const game = createGame({ scenarioId: 108, seed: 7 });
  tickState(game);
  expect(game.date.minuteOfDay % 60).not.toBe(0);
  const now = game.timeline.find((tick) => tick.minute === game.date.minute)!;
  const before = cloneDeep(game);
  const forecast = generateForecastTimeline(
    game,
    now.cash,
    now.customers,
    2 * 24,
    60,
  );
  const worker = forecastWorkerSnapshot(game);
  expect(
    generateForecastTimeline(worker, now.cash, now.customers, 2 * 24, 60),
  ).toEqual(forecast);
  const restored = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  loadSimData(restored.location);
  expect(
    generateForecastTimeline(restored, now.cash, now.customers, 2 * 24, 60),
  ).toEqual(forecast);
  expect(game).toEqual(before);
  tickState(game);
  loadSimData(before.location);
  tickState(before);
  expect(game).toEqual(before);
});
