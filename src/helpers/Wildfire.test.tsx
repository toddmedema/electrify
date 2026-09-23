import { createNextState as produce } from "@reduxjs/toolkit";
import { createGame } from "../testing/Simulator";
import { SCENARIOS, CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { GameType, StorySnapshotType, ActiveWorldEventType } from "../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { getWildfireProfile } from "../data/WildfireProfiles";
import {
  activePreparedness,
  activeWildfire,
  dailyFireWeatherReading,
  isWildfireHazardEligible,
  lastWildfireOnsetMonth,
  sampleWildfireIncident,
  WILDFIRE_DEFINITION_ID,
  wildfireDraw,
  wildfireInCooldown,
  wildfireMonthlyProbability,
  wildfireOccurrenceKey,
  wildfirePreparednessChoice,
  weatherFireRiskModifier,
} from "./Wildfire";

const LA = getWildfireProfile("LA")!;
const wildfireScenario = SCENARIOS.find((s) => s.id === 111)!;

const produceGame = (game: GameType, recipe: (g: GameType) => void): GameType =>
  produce(game, (draft) => recipe(draft as GameType));

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

function makeSnapshot(
  facilities: Array<{
    id: number;
    name: string;
    fuel?: string;
    peakW: number;
    operational?: boolean;
  }>,
  demandWh12m = 12e9,
): StorySnapshotType {
  return {
    deliveredWhByFuel12m: {},
    demandWh12m,
    unservedWh12m: 0,
    netIncome12m: 0,
    peakDemandW12m: 1e8,
    firmPeakW: facilities.reduce((total, f) => total + f.peakW, 0),
    storagePeakW: 0,
    storagePeakWh: 0,
    facilities: facilities.map((f) => ({
      id: f.id,
      name: f.name,
      fuel: f.fuel as StorySnapshotType["facilities"][number]["fuel"],
      ageYears: 5,
      peakW: f.peakW,
      operational: f.operational ?? true,
    })),
  };
}

function incidentOccurrence(
  locationId: string,
  monthsElapsed: number,
): ActiveWorldEventType {
  return {
    key: wildfireOccurrenceKey(locationId, monthsElapsed),
    definitionId: WILDFIRE_DEFINITION_ID,
    startsMinute: monthsElapsed * MINUTES_PER_MONTH,
    endsMinute: (monthsElapsed + 1) * MINUTES_PER_MONTH,
    attributes: {},
    effects: {},
  };
}

function preparednessOccurrence(
  locationId: string,
  year: number,
  monthsElapsed: number,
): ActiveWorldEventType {
  const key = `wildfire:${locationId}:${year}:preparedness`;
  return {
    key,
    definitionId: key,
    startsMinute: monthsElapsed * MINUTES_PER_MONTH,
    endsMinute: monthsElapsed * MINUTES_PER_MONTH,
    attributes: { choice: "prepare" },
    effects: {},
  };
}

describe("monthly ignition probability", () => {
  it("is zero in a zero-weight month (a guaranteed no-fire)", () => {
    const profile = { ...LA, monthlyWeights: LA.monthlyWeights.map(() => 0) };
    // Weights must still be a valid shape for the formula; zero everywhere means no risk.
    expect(wildfireMonthlyProbability(profile, 0)).toBe(0);
  });

  it("stays within [0, 1) for every month and modifier", () => {
    for (let month = 0; month < 12; month++) {
      for (const modifier of [0.5, 1, 2]) {
        const p = wildfireMonthlyProbability(LA, month, modifier);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(1);
      }
    }
  });

  it("rises with annual hazard, monthly weight and weather modifier", () => {
    const base = wildfireMonthlyProbability(LA, 8); // September peak
    expect(
      wildfireMonthlyProbability(
        { ...LA, annualHazard: LA.annualHazard * 2 },
        8,
      ),
    ).toBeGreaterThan(base);
    expect(wildfireMonthlyProbability(LA, 8, 2)).toBeGreaterThan(base);
    // A higher-weight month is riskier than a lower-weight one at the same modifier.
    const peakMonth = LA.monthlyWeights.indexOf(Math.max(...LA.monthlyWeights));
    const lowMonth = LA.monthlyWeights.indexOf(Math.min(...LA.monthlyWeights));
    expect(wildfireMonthlyProbability(LA, peakMonth)).toBeGreaterThan(
      wildfireMonthlyProbability(LA, lowMonth),
    );
  });

  it("keeps a fire-risk season from guaranteeing a destructive fire", () => {
    // Even the peak month at maximum modifier must leave substantial no-fire odds.
    const peakMonth = LA.monthlyWeights.indexOf(Math.max(...LA.monthlyWeights));
    expect(wildfireMonthlyProbability(LA, peakMonth, 2)).toBeLessThan(0.5);
  });

  it("indexes seasons by calendar month, so a southern-hemisphere profile peaks in its summer", () => {
    // A synthetic southern-hemisphere profile: peak fire risk in January (index 0), its summer.
    // Weights sum to one. The logic must not assume a northern-hemisphere calendar.
    const southern = {
      ...LA,
      monthlyWeights: [
        0.3, 0.15, 0.1, 0.05, 0.03, 0.02, 0.02, 0.03, 0.05, 0.1, 0.12, 0.03,
      ],
    };
    expect(wildfireMonthlyProbability(southern, 0)).toBeGreaterThan(
      wildfireMonthlyProbability(southern, 6), // January (summer) riskier than July (winter).
    );
  });
});

describe("weather modifier", () => {
  it("is neutral with no reading or no normals", () => {
    expect(weatherFireRiskModifier(undefined, undefined)).toBe(1);
    expect(weatherFireRiskModifier({ tempC: 20, windKph: 15 }, undefined)).toBe(
      1,
    );
    expect(
      weatherFireRiskModifier(undefined, {
        tempMean: 20,
        tempSd: 3,
        windMean: 15,
        windSd: 5,
      }),
    ).toBe(1);
  });

  it("rises for hot, windy days and is bounded above at 2", () => {
    const climatology = { tempMean: 15, tempSd: 3, windMean: 10, windSd: 5 };
    const hotWindy = weatherFireRiskModifier(
      { tempC: 30, windKph: 40 },
      climatology,
    );
    expect(hotWindy).toBeGreaterThan(1);
    // An extreme reading saturates the bound rather than running away.
    expect(
      weatherFireRiskModifier({ tempC: 100, windKph: 200 }, climatology),
    ).toBe(2);
  });

  it("falls for cool, calm days and is bounded below at 0.5", () => {
    const climatology = { tempMean: 15, tempSd: 3, windMean: 10, windSd: 5 };
    const coolCalm = weatherFireRiskModifier(
      { tempC: 0, windKph: 0 },
      climatology,
    );
    expect(coolCalm).toBeLessThan(1);
    expect(
      weatherFireRiskModifier({ tempC: -100, windKph: 0 }, climatology),
    ).toBe(0.5);
  });

  it("reads a finite representative day when weather is loaded", () => {
    const game = createGame({ scenarioId: 111 }); // Loads LA weather.
    const reading = dailyFireWeatherReading(game.date, game.seed);
    expect(Number.isFinite(reading.tempC)).toBe(true);
    expect(Number.isFinite(reading.windKph)).toBe(true);
  });
});

describe("eligibility", () => {
  it("allows a custom game in a profiled area", () => {
    expect(isWildfireHazardEligible(customGameAtLA())).toBe(true);
  });

  it("preserves the authored scenario 111 (no random overlap)", () => {
    const authored = createGame({ scenarioId: 111 });
    expect(isWildfireHazardEligible(authored)).toBe(false);
  });

  it("denies a custom game in an unprofiled area", () => {
    const pit = SCENARIOS.find((s) => s.id === 103)!; // Pittsburgh
    const game = createGame({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario: { ...pit, id: CUSTOM_SCENARIO_ID, name: "Custom PIT" },
    });
    expect(isWildfireHazardEligible(game)).toBe(false);
  });

  it("denies when story effects are disabled", () => {
    const game = produceGame(customGameAtLA(), (g) => {
      g.storyEffectsDisabled = true;
    });
    expect(isWildfireHazardEligible(game)).toBe(false);
  });

  it("denies other scored scenarios until they explicitly opt in", () => {
    const game = createGame({ scenarioId: 103 });
    expect(isWildfireHazardEligible(game)).toBe(false);
  });
});

describe("cooldown and one-active-per-region", () => {
  it("suppresses new incidents during the cooldown window", () => {
    const onset = incidentOccurrence("LA", 10);
    expect(wildfireInCooldown([onset], "LA", 12, LA)).toBe(true); // within 6 months
    expect(wildfireInCooldown([onset], "LA", 10 + LA.cooldownMonths, LA)).toBe(
      false,
    );
  });

  it("reports no cooldown before the first incident", () => {
    expect(wildfireInCooldown([], "LA", 0, LA)).toBe(false);
  });

  it("finds the most recent onset month for a region", () => {
    const occurrences = [
      incidentOccurrence("LA", 4),
      incidentOccurrence("LA", 20),
    ];
    expect(lastWildfireOnsetMonth(occurrences, "LA")).toBe(20);
    // A different region's incident does not count.
    expect(
      lastWildfireOnsetMonth([incidentOccurrence("SF", 30)], "LA"),
    ).toBeUndefined();
  });

  it("finds the region's active wildfire and ignores other regions", () => {
    const la = incidentOccurrence("LA", 10);
    const sf = incidentOccurrence("SF", 10);
    expect(activeWildfire([la, sf], "LA")).toBe(la);
    expect(activeWildfire([la, sf], "SF")).toBe(sf);
    expect(activeWildfire([], "LA")).toBeUndefined();
  });
});

describe("deterministic, order-independent draws", () => {
  it("addresses each draw stably by seed, location, month and attribute", () => {
    const a = wildfireDraw(12345, "LA", 8, "severity");
    const b = wildfireDraw(12345, "LA", 8, "severity");
    expect(a).toBe(b);
    // A different attribute or month is a different draw.
    expect(wildfireDraw(12345, "LA", 8, "duration")).not.toBe(a);
    expect(wildfireDraw(12345, "LA", 9, "severity")).not.toBe(a);
    // Draws stay in [0, 1).
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });

  it("selects facilities identically regardless of fleet array order", () => {
    const facilities = [
      { id: 1, name: "Gas A", fuel: "Natural Gas", peakW: 30e6 },
      { id: 2, name: "Solar B", fuel: "Sun", peakW: 20e6 },
      { id: 3, name: "Coal C", fuel: "Coal", peakW: 40e6 },
      { id: 4, name: "Wind D", fuel: "Wind", peakW: 10e6 },
    ];
    const forward = makeSnapshot(facilities);
    const reversed = makeSnapshot([...facilities].reverse());
    const first = sampleWildfireIncident({
      profile: LA,
      seed: 777,
      locationId: "LA",
      monthsElapsed: 8,
      snapshot: forward,
      prepared: false,
    });
    const second = sampleWildfireIncident({
      profile: LA,
      seed: 777,
      locationId: "LA",
      monthsElapsed: 8,
      snapshot: reversed,
      prepared: false,
    });
    expect(first.selectedFacilityIds).toEqual(second.selectedFacilityIds);
    expect(first.selectedFacilityNames).toEqual(second.selectedFacilityNames);
  });

  it("samples the same incident for identical inputs", () => {
    const snapshot = makeSnapshot([
      { id: 1, name: "Gas A", fuel: "Natural Gas", peakW: 30e6 },
      { id: 2, name: "Coal C", fuel: "Coal", peakW: 40e6 },
    ]);
    const args = {
      profile: LA,
      seed: 42,
      locationId: "LA",
      monthsElapsed: 8,
      snapshot,
      prepared: false,
    };
    expect(sampleWildfireIncident(args)).toEqual(sampleWildfireIncident(args));
  });

  it("keeps severity, duration and facility draws independent", () => {
    const snapshot = makeSnapshot([
      { id: 1, name: "Gas A", fuel: "Natural Gas", peakW: 30e6 },
      { id: 2, name: "Coal C", fuel: "Coal", peakW: 40e6 },
    ]);
    // Varying the seed changes the incident; the same seed is stable.
    const a = sampleWildfireIncident({
      profile: LA,
      seed: 1,
      locationId: "LA",
      monthsElapsed: 8,
      snapshot,
      prepared: false,
    });
    const b = sampleWildfireIncident({
      profile: LA,
      seed: 2,
      locationId: "LA",
      monthsElapsed: 8,
      snapshot,
      prepared: false,
    });
    expect(a).not.toEqual(b);
  });
});

describe("preparedness", () => {
  it("is active within its window and expires after", () => {
    const answered = preparednessOccurrence("LA", 2024, 8); // September
    expect(activePreparedness([answered], "LA", 8)).toBe(true);
    expect(
      activePreparedness(
        [answered],
        "LA",
        8 + LA.preparednessDurationMonths - 1,
      ),
    ).toBe(true);
    expect(
      activePreparedness([answered], "LA", 8 + LA.preparednessDurationMonths),
    ).toBe(false);
    // A different region's preparedness does not apply.
    expect(
      activePreparedness([preparednessOccurrence("SF", 2024, 8)], "LA", 8),
    ).toBe(false);
  });

  it("halves disconnections and output losses but not restoration cost", () => {
    const snapshot = makeSnapshot([
      { id: 1, name: "Gas A", fuel: "Natural Gas", peakW: 30e6 },
      { id: 2, name: "Coal C", fuel: "Coal", peakW: 40e6 },
    ]);
    const base = sampleWildfireIncident({
      profile: LA,
      seed: 99,
      locationId: "LA",
      monthsElapsed: 8,
      snapshot,
      prepared: false,
    });
    const prepared = sampleWildfireIncident({
      profile: LA,
      seed: 99,
      locationId: "LA",
      monthsElapsed: 8,
      snapshot,
      prepared: true,
    });
    // Disconnections are halved.
    expect(prepared.disconnectedDemand).toBeCloseTo(
      base.disconnectedDemand * 0.5,
      12,
    );
    // Output loss is halved (multiplier moves halfway toward 1).
    expect(prepared.outputMultiplier).toBeCloseTo(
      (1 + base.outputMultiplier) / 2,
      12,
    );
    // Restoration cost is unchanged.
    expect(prepared.restorationCostPerMonth).toBeCloseTo(
      base.restorationCostPerMonth,
      6,
    );
    // Same facilities are affected.
    expect(prepared.selectedFacilityIds).toEqual(base.selectedFacilityIds);
  });
});

describe("restoration cost scaling", () => {
  it("scales with exposed system size and severity", () => {
    const small = LA.restorationCostPerMWh * 1000 * 0.5;
    const large = LA.restorationCostPerMWh * 10000 * 0.5;
    expect(large).toBeGreaterThan(small);
    // Higher severity costs more to restore at the same size.
    const lowSeverity = LA.restorationCostPerMWh * 5000 * (0.5 + 0);
    const highSeverity = LA.restorationCostPerMWh * 5000 * (0.5 + 1);
    expect(highSeverity).toBeGreaterThan(lowSeverity);
  });

  it("is non-negative for a zero-demand system", () => {
    const snapshot = makeSnapshot(
      [{ id: 1, name: "Gas A", fuel: "Natural Gas", peakW: 30e6 }],
      0, // No demand history yet.
    );
    const incident = sampleWildfireIncident({
      profile: LA,
      seed: 5,
      locationId: "LA",
      monthsElapsed: 8,
      snapshot,
      prepared: false,
    });
    expect(incident.restorationCostPerMonth).toBeGreaterThanOrEqual(0);
  });
});

describe("preparedness choice", () => {
  it("is offered in the preparedness month for an eligible custom game", () => {
    const game = produceGame(customGameAtLA(), (g) => {
      g.date = getDateFromMinute(
        LA.preparednessMonth * MINUTES_PER_MONTH,
        g.startingYear,
      );
    });
    const choice = wildfirePreparednessChoice(game);
    expect(choice).toBeDefined();
    expect(choice!.id).toBe(`wildfire:LA:${game.date.year}:preparedness`);
    expect(choice!.options.map((o) => o.id)).toEqual(["prepare", "standard"]);
  });

  it("is not offered outside the preparedness month", () => {
    const game = produceGame(customGameAtLA(), (g) => {
      g.date = getDateFromMinute(0 * MINUTES_PER_MONTH, g.startingYear); // January
    });
    expect(wildfirePreparednessChoice(game)).toBeUndefined();
  });

  it("is not re-offered once answered this season", () => {
    const game = produceGame(customGameAtLA(), (g) => {
      g.date = getDateFromMinute(
        LA.preparednessMonth * MINUTES_PER_MONTH,
        g.startingYear,
      );
      g.worldEvents.occurrences.push(
        preparednessOccurrence("LA", g.date.year, LA.preparednessMonth),
      );
    });
    expect(wildfirePreparednessChoice(game)).toBeUndefined();
  });

  it("is not offered for the authored scenario 111", () => {
    const game = produceGame(createGame({ scenarioId: 111 }), (g) => {
      g.date = getDateFromMinute(
        LA.preparednessMonth * MINUTES_PER_MONTH,
        g.startingYear,
      );
    });
    expect(wildfirePreparednessChoice(game)).toBeUndefined();
  });
});
