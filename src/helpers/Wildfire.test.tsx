import { createNextState as produce } from "@reduxjs/toolkit";
import { createGame } from "../testing/Simulator";
import { SCENARIOS, CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { GameType, ActiveWorldEventType } from "../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { getWildfireProfile } from "../data/WildfireProfiles";
import {
  activeWildfire,
  isWildfireHazardEligible,
  sampleWildfireIncident,
  sampleWildfireSourceYear,
  summarizeWildfireImpact,
  WILDFIRE_DEFINITION_ID,
  wildfireDraw,
  wildfireHeavySmokeDays,
  wildfireIncidentEffects,
  wildfireOccurrenceKey,
  wildfireReferenceAttenuation,
  wildfireRiskNotice,
} from "./Wildfire";

const LA = getWildfireProfile("LA")!;
const SF = getWildfireProfile("SF")!;
const source2020 = { ...LA, sourceYears: [2020] };
const wildfireScenario = SCENARIOS.find((scenario) => scenario.id === 111)!;
const produceGame = (
  game: GameType,
  recipe: (game: GameType) => void,
): GameType => produce(game, (draft) => recipe(draft as GameType));

function customGameAtLA(): GameType {
  return createGame({
    scenarioId: CUSTOM_SCENARIO_ID,
    scenario: {
      ...wildfireScenario,
      id: CUSTOM_SCENARIO_ID,
      name: "Custom LA",
    },
  });
}

function occurrence(locationId = "LA", month = 8): ActiveWorldEventType {
  return {
    key: wildfireOccurrenceKey(locationId, month),
    definitionId: WILDFIRE_DEFINITION_ID,
    startsMinute: month * MINUTES_PER_MONTH,
    endsMinute: (month + 1) * MINUTES_PER_MONTH,
    attributes: { heavySmokeDays: 11 },
    effects: {},
  };
}

describe("historical annual smoke bootstrap", () => {
  it("selects the same source year across all twelve months", () => {
    const args = {
      profile: LA,
      seed: 42,
      locationId: "LA",
      startingYear: 2024,
    };
    const years = Array.from({ length: 12 }, (_, monthsElapsed) =>
      sampleWildfireSourceYear({ ...args, monthsElapsed }),
    );
    expect(new Set(years).size).toBe(1);
    expect(LA.sourceYears).toContain(years[0]);
    const reordered = [11, 0, 6, 2, 9].map((monthsElapsed) =>
      sampleWildfireSourceYear({ ...args, monthsElapsed }),
    );
    expect(reordered).toEqual(Array(5).fill(years[0]));
  });

  it("addresses year selection by seed, location, and absolute calendar year", () => {
    const sample = (seed: number, monthsElapsed: number, startingYear = 2024) =>
      sampleWildfireSourceYear({
        profile: LA,
        seed,
        locationId: "LA",
        monthsElapsed,
        startingYear,
      });
    expect(sample(2, 12, 2024)).toBe(sample(2, 0, 2025));
    expect(
      new Set(Array.from({ length: 100 }, (_, seed) => sample(seed, 0))).size,
    ).toBe(9);
    const draw = wildfireDraw(123, "LA", 2024, "source-year");
    expect(draw).toBe(wildfireDraw(123, "LA", 2024, "source-year"));
    expect(draw).not.toBe(wildfireDraw(123, "SF", 2024, "source-year"));
    expect(draw).toBeGreaterThanOrEqual(0);
    expect(draw).toBeLessThan(1);
  });

  it("preserves quiet years and monthly heavy-smoke clusters", () => {
    for (let month = 0; month < 12; month++) {
      expect(wildfireHeavySmokeDays(LA, 2019, month)).toBe(0);
      expect(wildfireHeavySmokeDays(SF, 2024, month)).toBe(0);
    }
    expect(wildfireHeavySmokeDays(LA, 2020, 7)).toBe(2);
    expect(wildfireHeavySmokeDays(LA, 2020, 8)).toBe(11);
    expect(wildfireHeavySmokeDays(SF, 2020, 7)).toBe(9);
    expect(wildfireHeavySmokeDays(SF, 2020, 8)).toBe(15);
    expect(wildfireHeavySmokeDays(SF, 2020, 9)).toBe(5);
  });

  it("rejects unreviewed dates and ignores lighter or unavailable detections", () => {
    expect(() => wildfireHeavySmokeDays(LA, 2016, 8)).toThrow(/catalogue/);
    expect(() => wildfireHeavySmokeDays(LA, 2020, 12)).toThrow(/month/);
    // LA's 25 detected days in 2017 were all light; its one unknown archive day is not heavy.
    for (let month = 0; month < 12; month++)
      expect(wildfireHeavySmokeDays(LA, 2017, month)).toBe(0);
  });
});

describe("physical boundary and monthly weighting", () => {
  const args = {
    profile: source2020,
    seed: 42,
    locationId: "LA",
    monthsElapsed: 8,
  };

  it("retains the regional reference and actual heavy-day count", () => {
    expect(wildfireReferenceAttenuation(LA)).toBeCloseTo(0.162, 12);
    expect(wildfireReferenceAttenuation(SF)).toBeCloseTo(0.174, 12);
    const incident = sampleWildfireIncident(args)!;
    expect(incident).toEqual({
      sourceYear: 2020,
      heavySmokeDays: 11,
      referenceAttenuation: 0.162,
      solarIrradianceMultiplier: expect.any(Number),
      durationMonths: 1,
    });
    // Eleven heavy days at 16.2% cannot impose a 16.2% loss throughout the month.
    expect(incident.solarIrradianceMultiplier).toBeCloseTo(0.9414136986, 9);
    expect(incident.solarIrradianceMultiplier).toBeGreaterThan(
      1 - incident.referenceAttenuation,
    );
    expect(
      sampleWildfireIncident({ ...args, monthsElapsed: 0 }),
    ).toBeUndefined();
  });

  it("attenuates solar irradiance only within the sampled daytime window", () => {
    const incident = sampleWildfireIncident(args)!;
    const effects = wildfireIncidentEffects(incident, LA);
    expect(Object.keys(effects.solarIrradianceMultipliersByHour!)).toEqual([
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
    ]);
    expect(effects.solarIrradianceMultipliersByHour!["10"]).toBe(
      incident.solarIrradianceMultiplier,
    );
    expect(effects.solarIrradianceMultipliersByHour!["9"]).toBeUndefined();
    expect(effects.solarIrradianceMultipliersByHour!["18"]).toBeUndefined();
    expect(effects).not.toHaveProperty("demandMultiplier");
    expect(effects).not.toHaveProperty("facilityOutputMultipliersById");
    expect(effects).not.toHaveProperty("operatingExpensePerMonth");
  });

  it("does not let backup readiness change airborne smoke", () => {
    expect(sampleWildfireIncident({ ...args, effectiveness: 1 })).toEqual(
      sampleWildfireIncident({ ...args, effectiveness: 0 }),
    );
  });

  it("increases the loss with a stronger reference or more detected heavy days", () => {
    const september = sampleWildfireIncident(args)!;
    const august = sampleWildfireIncident({ ...args, monthsElapsed: 7 })!;
    const stronger = sampleWildfireIncident({
      ...args,
      profile: { ...source2020, dailyReferenceAttenuation: [0.3] },
    })!;
    expect(september.solarIrradianceMultiplier).toBeLessThan(
      august.solarIrradianceMultiplier,
    );
    expect(stronger.solarIrradianceMultiplier).toBeLessThan(
      september.solarIrradianceMultiplier,
    );
  });
});

describe("game eligibility and reporting", () => {
  it("allows custom reviewed locations and denies authored or unsupported games", () => {
    expect(isWildfireHazardEligible(customGameAtLA())).toBe(true);
    expect(isWildfireHazardEligible(createGame({ scenarioId: 111 }))).toBe(
      false,
    );
    expect(isWildfireHazardEligible(createGame({ scenarioId: 103 }))).toBe(
      false,
    );
    expect(
      isWildfireHazardEligible(
        produceGame(customGameAtLA(), (game) => {
          game.location.id = "PIT";
        }),
      ),
    ).toBe(false);
    for (const field of [
      "storyEffectsDisabled",
      "wildfireHazardDisabled",
    ] as const) {
      expect(
        isWildfireHazardEligible(
          produceGame(customGameAtLA(), (game) => {
            game[field] = true;
          }),
        ),
      ).toBe(false);
    }
  });

  it("finds the local persisted smoke occurrence", () => {
    const local = occurrence();
    expect(activeWildfire([occurrence("SF"), local], "LA")).toBe(local);
    expect(activeWildfire([], "LA")).toBeUndefined();
  });

  it("reports smoke rather than fabricated disconnections or repair costs", () => {
    expect(
      summarizeWildfireImpact(
        [],
        [occurrence(), { ...occurrence(), definitionId: "other" }],
        2024,
      ),
    ).toEqual({
      incidentCount: 1,
      totalHeavySmokeDays: 11,
      totalDisconnectedWh: 0,
      averageSeverity: null,
      totalRestorationCost: 0,
    });
  });

  it("describes historical seasonal smoke without using a city's daily weather", () => {
    const game = produceGame(customGameAtLA(), (value) => {
      value.date = getDateFromMinute(8 * MINUTES_PER_MONTH, value.startingYear);
    });
    expect(wildfireRiskNotice(game)?.title).toBe("Wildfire smoke season");
    expect(
      wildfireRiskNotice(
        produceGame(game, (value) => {
          value.seed++;
        }),
      ),
    ).toEqual(wildfireRiskNotice(game));
    expect(
      wildfireRiskNotice(
        produceGame(game, (value) => {
          value.date = getDateFromMinute(
            4 * MINUTES_PER_MONTH,
            value.startingYear,
          );
        }),
      ),
    ).toBeUndefined();
    expect(
      wildfireRiskNotice(
        produceGame(game, (value) => {
          value.storyEffectsDisabled = true;
        }),
      ),
    ).toBeUndefined();
  });
});
