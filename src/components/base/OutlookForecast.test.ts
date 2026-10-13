import { TICK_MINUTES, TICKS_PER_YEAR } from "../../Constants";
import { createGame } from "../../testing/Simulator";
import reducer, { generateNewTimeline } from "../../reducers/Game";
import { schedulePolicy } from "../../reducers/GameActions";
import { reservoirOutlook } from "../../helpers/HydroOutlook";
import { intertieOutlook } from "../../helpers/IntertieOutlook";
import { intertieContextForGame } from "../../helpers/Transmission";
import { forecastWorkerSnapshot } from "./ForecastWorkerSnapshot";
import { computeOutlook, forecastCutoffIndex } from "./OutlookForecast";

it("preserves the old hydro forecast with an active fleet, story and pending customer policy", () => {
  const game = reducer(
    createGame({ scenarioId: 108, seed: 7 }),
    schedulePolicy({
      id: "efficiency",
      tier: "On",
      month: 1,
    }),
  );
  // Dispatch metadata is intentionally non-serialized; the game's saveable state stays fixed.
  const before = JSON.stringify(game);
  const now = game.timeline[0];
  const expected = reservoirOutlook(
    now,
    generateNewTimeline(game, now.cash, now.customers, TICKS_PER_YEAR),
    game.startingYear,
  );
  expect(computeOutlook("hydro", forecastWorkerSnapshot(game))).toEqual(
    expected,
  );
  expect(JSON.stringify(game)).toBe(before);
});

it("preserves neighboring-market outlooks using only the four returned hourly readings", () => {
  const game = reducer(
    createGame({ scenarioId: 108, seed: 17 }),
    schedulePolicy({
      id: "timeOfUse",
      tier: "On",
      month: 1,
    }),
  );
  const now = game.timeline[0];
  const full = generateNewTimeline(
    {
      ...game,
      facilities: game.facilities.filter((f) => f.yearsToBuildLeft <= 0),
      transmission: {
        tradingPolicy: game.transmission?.tradingPolicy || "BALANCED",
        lines: (game.transmission?.lines || [])
          .filter((l) => l.yearsToBuildLeft <= 0)
          .map((l) => ({ ...l, upgrade: undefined })),
      },
    },
    now.cash,
    now.customers,
    (TICKS_PER_YEAR * 2 * TICK_MINUTES) / 60,
    60,
  );
  const compact = computeOutlook("intertie", forecastWorkerSnapshot(game))!;
  expect(Object.keys(compact[0])).toEqual([
    "minute",
    "demandW",
    "temperatureC",
    "solarIrradianceWM2",
  ]);
  const context = intertieContextForGame(game);
  const expected = intertieOutlook(
    "spain-portugal-upgrade",
    context,
    full,
    game.date.minute,
  );
  expect(expected).toBeDefined();
  expect(
    intertieOutlook(
      "spain-portugal-upgrade",
      context,
      compact,
      game.date.minute,
    ),
  ).toEqual(expected);
  expect(
    intertieOutlook(
      "spain-portugal-upgrade",
      context,
      compact,
      game.date.minute + 75,
      65e6,
    ),
  ).toEqual(
    intertieOutlook(
      "spain-portugal-upgrade",
      context,
      full,
      game.date.minute + 75,
      65e6,
    ),
  );
});

it("keeps all forecast inputs while omitting growing playback and UI records", () => {
  const game = createGame({ scenarioId: 108, seed: 18 });
  const snapshot = forecastWorkerSnapshot(game);
  expect(snapshot.timeline).toBe(game.timeline);
  expect(snapshot.monthlyHistory).toBe(game.monthlyHistory);
  expect(snapshot.facilities).toBe(game.facilities);
  expect(snapshot.worldEvents).toBe(game.worldEvents);
  expect(snapshot.runIdentity).toBeUndefined();
  expect(snapshot.replayLog).toBeUndefined();
  expect(snapshot.eventLog).toEqual([]);
  expect(snapshot.meaningfulDecisions).toEqual([]);
});

it("changes the outlook cutoff only when a modeled hourly reading leaves the visible future", () => {
  const timeline = [0, 60, 120].map((minute) => ({
    minute,
    demandW: 1,
    temperatureC: 20,
    solarIrradianceWM2: 0,
  }));
  expect(
    [0, 15, 30, 60, 75, 120, 135].map((minute) =>
      forecastCutoffIndex(timeline, minute),
    ),
  ).toEqual([0, 1, 1, 1, 2, 2, 3]);
});
