import { TICK_MINUTES, TICKS_PER_YEAR } from "../../Constants";
import { createGame } from "../../testing/Simulator";
import reducer, { generateNewTimeline } from "../../reducers/Game";
import { schedulePolicy } from "../../reducers/GameActions";
import { reservoirOutlook } from "../../helpers/HydroOutlook";
import { intertieOutlook } from "../../helpers/IntertieOutlook";
import { intertieContextForGame } from "../../helpers/Transmission";
import { forecastWorkerSnapshot } from "./ForecastWorkerSnapshot";
import { computeOutlook, forecastCutoffIndex } from "./OutlookForecast";
import { GENERATORS } from "../../data/Facilities";
import { expectedMonthlyOutputShape } from "../../helpers/ExpectedOutput";

it("preserves generator quotes and typical-year output with compact worker readings", () => {
  const game = createGame({ scenarioId: 108, seed: 12345 });
  const before = JSON.stringify(game);
  const now = game.timeline[0];
  const full = generateNewTimeline(
    game,
    now.cash,
    now.customers,
    TICKS_PER_YEAR * 3,
  );
  const compact = computeOutlook("build", forecastWorkerSnapshot(game))!;
  const quote = (forecast: typeof compact) =>
    GENERATORS(
      game,
      100e6,
      forecast.windSpeeds,
      forecast.solarIrradiances,
      forecast.offshoreWindSpeeds,
      forecast.airborneWindSpeeds,
    );
  const expected = {
    timeline: full,
    windSpeeds: full.map((tick) => tick.windKph),
    offshoreWindSpeeds: full.flatMap((tick) =>
      tick.windOffshoreKph === undefined ? [] : [tick.windOffshoreKph],
    ),
    airborneWindSpeeds: full.map((tick) => tick.windAirborneKph),
    solarIrradiances: full.map((tick) => tick.solarIrradianceWM2),
  };
  expect(quote(compact)).toEqual(quote(expected));
  for (const generator of quote(compact))
    expect(expectedMonthlyOutputShape(generator, compact.timeline)).toEqual(
      expectedMonthlyOutputShape(generator, full),
    );
  expect(compact.timeline[0]).not.toHaveProperty("cash");
  expect(JSON.stringify(game)).toBe(before);
});

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

it("keeps all forecast inputs while omitting growing UI records", () => {
  const game = createGame({ scenarioId: 108, seed: 18 });
  const snapshot = forecastWorkerSnapshot(game);
  expect(snapshot.timeline).toBe(game.timeline);
  expect(snapshot.monthlyHistory).toBe(game.monthlyHistory);
  expect(snapshot.facilities).toBe(game.facilities);
  expect(snapshot.worldEvents).toBe(game.worldEvents);
  expect(snapshot.runIdentity).toBeUndefined();
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

it("retains the wildfire restriction through the compact worker forecast", () => {
  const game = createGame({ scenarioId: 111, seed: 7 });
  game.date = { ...game.date, minute: 35 * 1440, monthsElapsed: 35 };
  game.timeline = generateNewTimeline(game, 1e9, game.timeline[0].customers);
  const compact = computeOutlook("intertie", forecastWorkerSnapshot(game))!;
  expect(
    compact.find((tick) => tick.minute === 36 * 1440)
      ?.transmissionCapacityLimitsWByCorridor,
  ).toEqual({ "california-north": 4e6 });
  expect(
    compact.find((tick) => tick.minute === 38 * 1440)
      ?.transmissionCapacityLimitsWByCorridor,
  ).toBeUndefined();
});
