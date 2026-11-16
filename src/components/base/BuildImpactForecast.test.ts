import { createGame } from "../../testing/Simulator";
import { GENERATORS, STORAGE } from "../../data/Facilities";
import reducer, {
  buildFacility,
  generateForecastTimeline,
  previewFacilityBuild,
} from "../../reducers/Game";
import { TICK_MINUTES, TICKS_PER_YEAR } from "../../Constants";
import {
  EMPTY_HISTORY,
  getDateFromMinute,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import { computeOutlook } from "./OutlookForecast";
import { forecastShortfalls } from "../../helpers/ForecastShortfalls";
import { forecastWorkerSnapshot } from "./ForecastWorkerSnapshot";

function fixture() {
  const game = createGame({ scenarioId: 100, seed: 12345 });
  game.timeline.forEach((tick) => {
    tick.cash = 1e12;
  });
  const generator = GENERATORS(game, 50e6, [], []).find(
    (quote) => quote.name === "Natural Gas Peaker",
  )!;
  return { game, generator };
}

it.each(["generator", "storage"] as const)(
  "forecasts a remote %s exactly as the selected territory's purchased fleet",
  (kind) => {
    const game = createGame({ scenarioId: 116, seed: 188 });
    game.territoryNetwork = {
      version: 3,
      landPurchases: [{ territoryId: "green-uplands", minute: 0, price: 18e6 }],
      legacyConnections: [],
    };
    game.date.year = 2020;
    game.timeline.forEach((tick) => {
      tick.cash = 1e12;
    });
    const facility = {
      ...(kind === "generator"
        ? GENERATORS(game, 100e6, [], []).find(
            (quote) => quote.name === "Wind",
          )!
        : STORAGE(game, 100e6).find((quote) => quote.name === "Battery")!),
    };
    const result = previewFacilityBuild(game, facility, "green-uplands");
    const purchased = reducer(
      game,
      buildFacility({
        facility,
        financed: false,
        territoryId: "green-uplands",
      }),
    );
    expect(purchased.facilities).toHaveLength(game.facilities.length + 1);
    expect(
      purchased.facilities.find(
        (facility) => !game.facilities.some(({ id }) => id === facility.id),
      )?.territoryId,
    ).toBe("green-uplands");
    const now = game.timeline[0];
    const actual = generateForecastTimeline(
      purchased,
      now.cash,
      now.customers,
      Math.ceil((facility.yearsToBuild * TICKS_PER_YEAR * TICK_MINUTES) / 60) +
        (TICKS_PER_YEAR * TICK_MINUTES) / 60 +
        2,
      60,
    ).filter(
      (tick) =>
        tick.minute >= result.commissionedMinute &&
        tick.minute < result.commissionedMinute + TICKS_PER_YEAR * TICK_MINUTES,
    );
    const grid = (tick: (typeof actual)[number]) => ({
      minute: tick.minute,
      reserveW: tick.reserveW,
      storageChargeW: tick.storageChargeW,
      storageDischargeW: tick.storageDischargeW,
      territories: tick.territories,
    });
    result.after.forEach((tick, index) =>
      expect(grid(tick)).toEqual(grid(actual[index])),
    );
    const remote = computeOutlook(
      "buildImpact",
      game,
      facility,
      "green-uplands",
    )!;
    expect(remote).toEqual(
      computeOutlook(
        "buildImpact",
        forecastWorkerSnapshot(game),
        facility,
        "green-uplands",
      ),
    );
    expect(
      JSON.stringify(remote) ===
        JSON.stringify(computeOutlook("buildImpact", game, facility)),
    ).toBe(kind === "storage");
    expect(computeOutlook("buildImpact", game, facility, "champlain")).toEqual(
      computeOutlook("buildImpact", game, facility),
    );
  },
);

it("uses the actual purchased fleet around commissioning without changing the live game", () => {
  const { game, generator: quote } = fixture();
  const generator = { ...quote, yearsToBuild: 1.25 };
  const original = JSON.stringify(game);
  const result = previewFacilityBuild(game, generator);
  const purchased = reducer(
    game,
    buildFacility({ facility: generator, financed: false }),
  );
  const now = game.timeline[0];
  const year = 12 * MINUTES_PER_MONTH;
  const ticks =
    Math.ceil(
      ((generator.yearsToBuild + 1) * TICKS_PER_YEAR * TICK_MINUTES) / 60,
    ) + 2;
  const actual = generateForecastTimeline(
    purchased,
    now.cash,
    now.customers,
    ticks,
    60,
  );
  const baseline = generateForecastTimeline(
    game,
    now.cash,
    now.customers,
    ticks,
    60,
  );
  const grid = (timeline: typeof actual) =>
    timeline.map((tick) => [
      tick.minute,
      tick.supplyW,
      tick.demandW,
      tick.reserveW,
    ]);
  const opening = result.after[0].minute;
  expect(grid(result.before)).toEqual(
    grid(
      baseline.filter(
        (tick) => tick.minute >= opening - year && tick.minute < opening,
      ),
    ),
  );
  expect(grid(result.after)).toEqual(
    grid(
      actual.filter(
        (tick) => tick.minute >= opening && tick.minute < opening + year,
      ),
    ),
  );
  expect(result.before.map((tick) => tick.reserveW)).not.toEqual(
    result.after.map((tick) => tick.reserveW),
  );
  expect(JSON.stringify(game)).toBe(original);
});

it("compares the twelve months immediately before and after a long build opens", () => {
  const { game, generator } = fixture();
  const result = previewFacilityBuild(game, { ...generator, yearsToBuild: 2 });
  const year = 12 * MINUTES_PER_MONTH;
  expect(result.before).toHaveLength(288);
  expect(result.after).toHaveLength(288);
  expect(result.after[0].minute).toBeGreaterThanOrEqual(
    game.date.minute + 2 * year,
  );
  expect(result.before[0].minute).toBe(result.after[0].minute - year);
  expect(result.before.at(-1)!.minute + 60).toBe(result.after[0].minute);
  expect(result.after.at(-1)!.minute + 60).toBe(result.after[0].minute + year);
});

it("includes storage dispatch and keeps compact worker results identical", () => {
  const { game } = fixture();
  const storage = STORAGE(game, 100e6).find(
    (quote) => quote.name === "Battery",
  )!;
  const result = computeOutlook("buildImpact", game, storage)!;
  expect(result).toEqual(
    computeOutlook("buildImpact", forecastWorkerSnapshot(game), storage),
  );
  expect(result.before.monthlyMarginW).toContain(null);
  expect(
    result.after.monthlyMarginW.every(
      (value) => value !== null && Number.isFinite(value),
    ),
  ).toBe(true);
  const purchased = reducer(
    game,
    buildFacility({ facility: storage, financed: false }),
  );
  expect(purchased.facilities).toHaveLength(game.facilities.length + 1);
  const now = game.timeline[0];
  const expected = generateForecastTimeline(
    purchased,
    now.cash,
    now.customers,
    Math.ceil(
      ((storage.yearsToBuild + 1) * TICKS_PER_YEAR * TICK_MINUTES) / 60,
    ) + 2,
    60,
  );
  const actual = previewFacilityBuild(game, storage).after;
  const opening = actual[0].minute;
  const selected = expected.filter(
    (tick) =>
      tick.minute >= opening && tick.minute < opening + 12 * MINUTES_PER_MONTH,
  );
  expect(actual.map((tick) => tick.storageDischargeW)).toEqual(
    selected.map((tick) => tick.storageDischargeW),
  );
});

it("uses recorded monthly extrema and energy in the year before an immediate opening", () => {
  const { game, generator } = fixture();
  const now = game.timeline[0];
  game.date = getDateFromMinute(12 * MINUTES_PER_MONTH, game.startingYear);
  game.timeline = generateForecastTimeline(game, now.cash, now.customers);
  game.monthlyHistory = Array.from({ length: 12 }, (_, index) => ({
    ...EMPTY_HISTORY,
    year: game.startingYear,
    month: index + 1,
    minimumSupplyMarginW: 1000 + index,
    demandWh: 1000 + index,
    supplyWh: 900,
  })).reverse();
  const result = computeOutlook("buildImpact", game, {
    ...generator,
    yearsToBuild: 0,
  })!;
  expect(result.before.monthlyMarginW).toEqual(
    Array.from({ length: 12 }, (_, index) => 1000 + index),
  );
  expect(result.before.unservedWh).toBe(1266);
  expect(result.after.startMinute).toBe(game.date.minute);
  expect(result.before.startMinute).toBe(0);
});

it("keeps missing pre-game history as gaps while forecasting the construction months", () => {
  const { game, generator } = fixture();
  const result = computeOutlook("buildImpact", game, {
    ...generator,
    yearsToBuild: 0.25,
  })!;
  expect(result.before.startMinute).toBeLessThan(0);
  expect(result.before.monthlyMarginW).toContain(null);
  expect(result.before.monthlyMarginW.some((value) => value !== null)).toBe(
    true,
  );
  expect(result.before.unservedWh).toBeNull();
  expect(
    result.after.monthlyMarginW.every(
      (value) => value !== null && Number.isFinite(value),
    ),
  ).toBe(true);
  expect(result.after.startMinute - result.before.startMinute).toBe(
    12 * MINUTES_PER_MONTH,
  );
});

it("uses recorded ticks for the completed part of the current month", () => {
  const { game, generator } = fixture();
  const now = game.timeline[0];
  const month = 12 * MINUTES_PER_MONTH;
  game.date = getDateFromMinute(month + 60, game.startingYear);
  game.timeline = [
    ...Array.from({ length: 4 }, (_, index) => ({
      ...now,
      minute: month + index * TICK_MINUTES,
      reserveW: -777,
    })),
    ...generateForecastTimeline(game, now.cash, now.customers),
  ];
  const result = computeOutlook("buildImpact", game, {
    ...generator,
    yearsToBuild: 0,
  })!;
  expect(result.before.monthlyMarginW.at(-1)).toBe(-777);
});

it("counts exactly one operating year of energy across partial calendar months", () => {
  const { game } = fixture();
  game.facilities = [];
  game.transmission = { ...game.transmission!, buyingRule: "NONE", lines: [] };
  game.date = getDateFromMinute(TICK_MINUTES, game.startingYear);
  const storage = {
    ...STORAGE(game, 100e6).find((quote) => quote.name === "Battery")!,
    yearsToBuild: 0,
  };
  const ticks = previewFacilityBuild(game, storage).after;
  const expected = forecastShortfalls(ticks, 60, 0).blackoutTotalWh;
  const result = computeOutlook("buildImpact", game, storage)!;
  expect(expected).toBeGreaterThan(0);
  expect(result.months).toHaveLength(13);
  expect(result.after.unservedWh! / expected).toBeCloseTo(1, 12);
});
