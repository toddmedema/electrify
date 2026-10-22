import cloneDeep from "lodash.clonedeep";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { combineStoryEffects } from "../data/WorldEvents";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { getSolarOutputFactor } from "../helpers/Energy";
import { emptyPolicies } from "../helpers/Policies";
import { createGame } from "../testing/Simulator";
import { GameType } from "../Types";
import { generateNewTimeline } from "./Game";

function fixture(solar: boolean, hour = 12, month = 1): GameType {
  const scenario = {
    ...DEFAULT_CUSTOM_SCENARIO,
    facilities: solar
      ? [{ name: "Solar", peakW: 1_000_000 }]
      : [
          { name: "Natural Gas Peaker", peakW: 1_000_000 },
          { name: "Hydro", peakW: 1_000_000 },
        ],
  };
  const game = createGame({ scenarioId: scenario.id, scenario, seed: 44 });
  game.date = getDateFromMinute(
    month * MINUTES_PER_MONTH + hour * 60,
    game.startingYear,
  );
  game.policies = emptyPolicies(game.date.monthsElapsed);
  if (solar) game.policies.programs.solar.adoption = 0.05;
  return game;
}

function withSmoke(
  game: GameType,
  multiplier: number,
  byHour?: Record<string, number>,
): GameType {
  const smoke = cloneDeep(game);
  const event = {
    key: `smoke:test:${multiplier}:${JSON.stringify(byHour)}`,
    definitionId: "smoke",
    startsMinute: game.date.monthsElapsed * MINUTES_PER_MONTH,
    endsMinute: (game.date.monthsElapsed + 1) * MINUTES_PER_MONTH,
    attributes: { solarIrradianceMultiplier: multiplier },
    effects: {
      solarIrradianceMultiplier: multiplier,
      ...(byHour === undefined
        ? {}
        : { solarIrradianceMultipliersByHour: byHour }),
    },
  };
  smoke.worldEvents.active.push(event);
  smoke.worldEvents.occurrences.push(event);
  return smoke;
}

function sample(game: GameType) {
  return generateNewTimeline(game, 1_000_000_000, 2_000_000, 1)[0];
}

describe("smoke in the solar resource", () => {
  it("multiplies overlapping attenuation and preserves a complete sunlight cutoff", () => {
    expect(
      combineStoryEffects([
        { effects: { solarIrradianceMultiplier: 0.8 } },
        { effects: { solarIrradianceMultiplier: 0.5 } },
      ]).solarIrradianceMultiplier,
    ).toBeCloseTo(0.4, 10);
    expect(
      combineStoryEffects([
        { effects: { solarIrradianceMultiplier: 0 } },
        { effects: { solarIrradianceMultiplier: 0.5 } },
      ]).solarIrradianceMultiplier,
    ).toBe(0);
    expect(combineStoryEffects([]).solarIrradianceMultiplier).toBeUndefined();
  });

  it("composes hourly attenuation at matching hours without filling unobserved hours", () => {
    expect(
      combineStoryEffects([
        {
          effects: { solarIrradianceMultipliersByHour: { "10": 0.8, "12": 0 } },
        },
        {
          effects: {
            solarIrradianceMultipliersByHour: { "10": 0.5, "17": 0.9 },
          },
        },
      ]).solarIrradianceMultipliersByHour,
    ).toEqual({ "10": 0.4, "12": 0, "17": 0.9 });
  });

  it("attenuates the shared sunlight once for rooftop and utility PV, including reforecasts", () => {
    const game = fixture(true);
    const baseline = sample(game);
    const smoke = withSmoke(game, 0.8, { "12": 0.5 });
    const affected = sample(smoke);
    expect(baseline.solarIrradianceWM2).toBeGreaterThan(0);
    expect(affected.solarIrradianceWM2).toBeCloseTo(
      baseline.solarIrradianceWM2 * 0.4,
      10,
    );
    const expectedOutputShare =
      getSolarOutputFactor(
        baseline.solarIrradianceWM2 * 0.4,
        baseline.temperatureC,
      ) /
      getSolarOutputFactor(baseline.solarIrradianceWM2, baseline.temperatureC);
    expect(baseline.supplyByFuel.Sun).toBeGreaterThan(0);
    expect(baseline.rooftopSolarW).toBeGreaterThan(0);
    expect(affected.supplyByFuel.Sun! / baseline.supplyByFuel.Sun!).toBeCloseTo(
      expectedOutputShare,
      10,
    );
    expect(affected.rooftopSolarW! / baseline.rooftopSolarW!).toBeCloseTo(
      expectedOutputShare,
      10,
    );
    smoke.timeline = [affected];
    expect(sample(smoke)).toEqual(affected);
  });

  it.each([
    [9, 1],
    [10, 0.8],
    [17, 0.8],
    [18, 1],
  ])(
    "keeps a 10am–6pm evidence window within its hourly boundaries at %s:00",
    (hour, retained) => {
      const game = fixture(true, hour, 6);
      const baseline = sample(game);
      const hours = Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [String(index + 10), 0.8]),
      );
      const affected = sample(withSmoke(game, 1, hours));
      expect(baseline.solarIrradianceWM2).toBeGreaterThan(0);
      expect(affected.solarIrradianceWM2).toBeCloseTo(
        baseline.solarIrradianceWM2 * retained,
        10,
      );
      const outputShare =
        getSolarOutputFactor(
          baseline.solarIrradianceWM2 * retained,
          baseline.temperatureC,
        ) /
        getSolarOutputFactor(
          baseline.solarIrradianceWM2,
          baseline.temperatureC,
        );
      expect(
        affected.supplyByFuel.Sun! / baseline.supplyByFuel.Sun!,
      ).toBeCloseTo(outputShare, 10);
      expect(affected.rooftopSolarW! / baseline.rooftopSolarW!).toBeCloseTo(
        outputShare,
        10,
      );
    },
  );

  it("cannot derate gas or hydro generation when sunlight is lost", () => {
    const game = fixture(false);
    const baseline = sample(game);
    const affected = sample(withSmoke(game, 0));
    expect(baseline.supplyByFuel["Natural Gas"]).toBeGreaterThan(0);
    expect(baseline.supplyByFuel.Hydro).toBeGreaterThan(0);
    expect(affected.solarIrradianceWM2).toBe(0);
    expect(affected.supplyByFuel).toEqual(baseline.supplyByFuel);
    expect(affected.demandW).toBe(baseline.demandW);
  });
});
