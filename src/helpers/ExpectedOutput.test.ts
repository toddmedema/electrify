import { TICKS_PER_YEAR } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { generateNewTimeline } from "../reducers/Game";
import { createGame } from "../testing/Simulator";
import { GameType, TickPresentFutureType } from "../Types";
import { MINUTES_PER_MONTH } from "./DateTime";
import { HYDRO_TARGET_CAPACITY_FACTOR } from "./Hydro";
import {
  expectedMonthlyOutputShape,
  monthlyRenewableCapacityFactors,
} from "./ExpectedOutput";

function forecast(game: GameType): TickPresentFutureType[] {
  return generateNewTimeline(
    game,
    game.timeline[0].cash,
    game.timeline[0].customers,
    TICKS_PER_YEAR * 3,
  );
}

function generator(game: GameType, name: string, timeline = forecast(game)) {
  return GENERATORS(
    game,
    500_000_000,
    timeline.map((tick) => tick.windKph),
    timeline.map((tick) => tick.solarIrradianceWM2),
  ).find((candidate) => candidate.name === name)!;
}

function solarTick(minute: number, irradiance: number): TickPresentFutureType {
  return {
    minute,
    windKph: 0,
    windAirborneKph: 0,
    solarIrradianceWM2: irradiance,
    hydroRunoffMm: 0,
  } as TickPresentFutureType;
}

describe("expectedMonthlyOutputShape", () => {
  const solar = { name: "Solar", fuel: "Sun" as const, peakW: 1_000_000 };

  it("averages each calendar month across forecast years", () => {
    // Two years: January is 0 then 1000 W/m², every other month a steady 500
    const timeline = Array.from({ length: 24 }, (_, month) =>
      solarTick(
        month * MINUTES_PER_MONTH,
        month === 0 ? 0 : month === 12 ? 1000 : 500,
      ),
    );
    const shape = expectedMonthlyOutputShape(solar, timeline)!;
    const steady = shape.monthly[1];

    expect(shape.kind).toBe("weather");
    expect(shape.monthly).toHaveLength(12);
    expect(shape.monthly[0]).toBeGreaterThan(0);
    expect(shape.monthly[0]).toBeLessThan(steady);
    expect(shape.lowMonth).toBe(0);
    expect(shape.mean).toBeCloseTo(
      shape.monthly.reduce((total, value) => total + value, 0) / 12,
    );
  });

  it("waits for a full year of forecast rather than drawing zeros", () => {
    const timeline = [solarTick(0, 500), solarTick(MINUTES_PER_MONTH, 500)];
    expect(expectedMonthlyOutputShape(solar, timeline)).toBeUndefined();
    expect(expectedMonthlyOutputShape(solar, [])).toBeUndefined();
  });

  it("gives zero solar in a month without daylight", () => {
    const timeline = Array.from({ length: 12 }, (_, month) =>
      solarTick(month * MINUTES_PER_MONTH, month === 11 ? 0 : 400),
    );
    const shape = expectedMonthlyOutputShape(solar, timeline)!;
    expect(shape.monthly[11]).toBe(0);
    expect(shape.lowMonth).toBe(11);
  });

  it.each(["Natural Gas", "Coal", "Nuclear"])(
    "treats %s as available on demand",
    (name) => {
      const game = createGame({ scenarioId: 104 });
      const plant = GENERATORS(game, 500_000_000, [], []).find(
        (candidate) => candidate.name === name,
      );
      if (!plant) {
        return;
      }
      expect(expectedMonthlyOutputShape(plant, [])).toEqual({
        kind: "on-demand",
        monthly: [],
        mean: 1,
        lowMonth: 0,
      });
    },
  );

  it("is deterministic for the same seed and location", () => {
    const game = createGame({ scenarioId: 108 });
    const timeline = forecast(game);
    const wind = generator(game, "Wind", timeline);
    expect(expectedMonthlyOutputShape(wind, timeline)).toEqual(
      expectedMonthlyOutputShape(wind, forecast(game)),
    );
  });

  it("follows the hemisphere's seasons for solar", () => {
    const madrid = createGame({ scenarioId: 108 });
    const johannesburg = createGame({ scenarioId: 113 });
    const north = expectedMonthlyOutputShape(
      generator(madrid, "Solar"),
      forecast(madrid),
    )!;
    const south = expectedMonthlyOutputShape(
      generator(johannesburg, "Solar"),
      forecast(johannesburg),
    )!;
    expect([10, 11, 0, 1]).toContain(north.lowMonth);
    expect([4, 5, 6, 7]).toContain(south.lowMonth);
  });

  it("describes hydro by its water inflow", () => {
    // Pittsburgh's wet, snowy watershed is sized close to the target; drier ones fall well short
    const game = createGame({ scenarioId: 102 });
    const timeline = forecast(game);
    const hydro = generator(game, "Hydro", timeline);
    const shape = expectedMonthlyOutputShape(hydro, timeline)!;
    expect(shape.kind).toBe("water-inflow");
    shape.monthly.forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
    expect(shape.mean).toBeGreaterThan(HYDRO_TARGET_CAPACITY_FACTOR / 2);
    expect(shape.mean).toBeLessThan(HYDRO_TARGET_CAPACITY_FACTOR * 2);
  });

  it("uses the same formula as the Forecasts chart", () => {
    const game = createGame({ scenarioId: 108 });
    const timeline = forecast(game).filter(
      (tick) => tick.minute < 12 * MINUTES_PER_MONTH + game.date.minute,
    );
    const wind = generator(game, "Wind", timeline);
    const byMonth = monthlyRenewableCapacityFactors(timeline, [wind]);
    const shape = expectedMonthlyOutputShape(wind, timeline);
    if (byMonth.length !== 12 || !shape) {
      return;
    }
    byMonth.forEach((point) => {
      const month = Math.floor(point.minute / MINUTES_PER_MONTH) % 12;
      expect(shape.monthly[month]).toBeCloseTo(point.factors.Wind);
    });
  });
});
