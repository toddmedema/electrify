import cloneDeep from "lodash.clonedeep";
import gameReducer, {
  delta,
  resume,
  retrofitFacility,
  sellFacility,
  tickState,
  togglePauseFacility,
} from "./Game";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../data/Scenarios";
import { parseSave, serializeSave } from "../SaveGame";
import { decodeReplay, encodeReplay, serializeReplay } from "../Replay";
import {
  COLD_DEFINITION_ID,
  facilityHazardStatus,
  HAIL_DEFINITION_ID,
  hailOccurs,
  hazardEventKey,
  isWeatherHazardEligible,
  representativeMinTempC,
  retrofitCost,
  sampleHailImpacts,
} from "../helpers/Hazards";
import {
  WEATHER_HAZARD_AUTHORED_FREEZE_SCENARIOS,
  WEATHER_HAZARD_TUTORIAL_SCENARIOS,
} from "../data/Hazards";
import { getDateFromMinute, getTimeFromTimeline } from "../helpers/DateTime";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { TICK_MINUTES } from "../Constants";
import { ActiveWorldEventType, GameType, ScenarioType } from "../Types";
import { getSimLocation } from "../testing/SimData";

jest.setTimeout(180000);

const base = SCENARIOS.find((s) => s.id === 101)!;

function scenarioAt(
  locationId: string,
  facilities: ScenarioType["facilities"],
): ScenarioType {
  return {
    ...base,
    id: CUSTOM_SCENARIO_ID,
    name: `Custom ${locationId}`,
    locationId,
    location: getSimLocation(locationId),
    cash: 2000000000,
    facilities,
  };
}

const DENVER = scenarioAt("Denver", [
  { fuel: "Sun", peakW: 200000000, initialAgeYears: 2 },
  { fuel: "Sun", peakW: 100000000, initialAgeYears: 2 },
  { fuel: "Natural Gas", peakW: 600000000, initialAgeYears: 5 },
  { fuel: "Oil", peakW: 400000000, initialAgeYears: 5 },
]);

function game(scenario: ScenarioType, seed: number): GameType {
  return createGame({ scenarioId: scenario.id, scenario, seed });
}

// Redux Toolkit freezes reducer output in development; tickState mutates in place.
function dispatch(state: GameType, action: Parameters<typeof gameReducer>[1]) {
  return cloneDeep(gameReducer(state, action));
}

function tickToMonth(state: GameType, month: number) {
  while (state.date.monthsElapsed < month) tickState(state);
}

function tickToMinute(state: GameType, minute: number) {
  while (state.date.minute < minute) tickState(state);
}

const hailOccurrences = (state: GameType) =>
  state.worldEvents.occurrences.filter(
    (e) => e.definitionId === HAIL_DEFINITION_ID,
  );

/**
 * The first (seed, month) at which a hailstorm damages the Denver fleet. Found from the pure,
 * addressed draws rather than by simulating, so every test below is grounded in a real storm.
 */
function findHailMonth(): { seed: number; month: number } {
  const template = game(DENVER, 1);
  for (let seed = 1; seed <= 600; seed++) {
    const probe = { ...template, seed };
    for (let month = 2; month <= 9; month++) {
      const date = getDateFromMinute(
        month * MINUTES_PER_MONTH,
        probe.startingYear,
      );
      const key = hazardEventKey("HAIL", probe.location.id, month);
      if (
        hailOccurs(probe, key, date.monthNumber - 1) &&
        sampleHailImpacts({ game: probe, key }).length
      ) {
        return { seed, month };
      }
    }
  }
  throw new Error("No hail found for any seed");
}

const HAIL = findHailMonth();

/** A Denver run ticked to the start of the hail month, with the clock running beforehand. */
function atHailOnset(): { state: GameType; hits: ActiveWorldEventType[] } {
  const state = game(DENVER, HAIL.seed);
  tickToMinute(state, HAIL.month * MINUTES_PER_MONTH - TICK_MINUTES);
  state.speed = "NORMAL";
  tickState(state);
  expect(state.date.monthsElapsed).toBe(HAIL.month);
  return { state, hits: hailOccurrences(state) };
}

describe("hail damage", () => {
  it("records one occurrence per damaged facility and one pausing log per storm", () => {
    const { state, hits } = atHailOnset();
    const key = hazardEventKey("HAIL", "Denver", HAIL.month);
    expect(hits.length).toBeGreaterThan(0);
    hits.forEach((hit) => {
      expect(hit.attributes.eventKey).toBe(key);
      expect(hit.startsMinute).toBe(HAIL.month * MINUTES_PER_MONTH);
      expect(hit.endsMinute).toBeGreaterThan(hit.startsMinute);
      const facility = state.facilities.find(
        (f) => f.id === hit.attributes.facilityId,
      )!;
      expect(facility.fuel).toBe("Sun");
      expect(facility && facilityHazardStatus(state, facility)?.label).toBe(
        "Hail damage",
      );
    });
    const logs = state.eventLog.filter((e) => e.storyPhaseKey === key);
    expect(logs).toHaveLength(1);
    expect(logs[0].importance).toBe("CRITICAL");
    expect(logs[0].message).toMatch(
      /^Severe hail damaged \d+% of your solar fleet/,
    );
    expect(state.speed).toBe("PAUSED");
    // Continuing the month does not announce or record the storm again.
    tickToMonth(state, HAIL.month + 1);
    expect(state.eventLog.filter((e) => e.storyPhaseKey === key)).toHaveLength(
      1,
    );
    expect(hailOccurrences(state)).toHaveLength(hits.length);
  });

  it("is independent of fleet order", () => {
    const { hits } = atHailOnset();
    const reordered = game(DENVER, HAIL.seed);
    reordered.facilities.reverse();
    tickToMonth(reordered, HAIL.month);
    expect(
      hailOccurrences(reordered).map((e) => [e.key, e.attributes.oneTimeCost]),
    ).toEqual(hits.map((e) => [e.key, e.attributes.oneTimeCost]));
  });

  it("charges each deductible exactly once, even across a re-forecast", () => {
    const { state, hits } = atHailOnset();
    const deductible = hits.reduce(
      (total, e) => total + Number(e.attributes.oneTimeCost),
      0,
    );
    expect(deductible).toBeGreaterThan(0);
    // The control differs only in the deductible, zeroed before it falls due.
    let control = cloneDeep(state);
    control.worldEvents.active.forEach((e) => {
      if (e.definitionId === HAIL_DEFINITION_ID) e.attributes.oneTimeCost = 0;
    });
    let charged = state;
    // One tick in the deductible is booked; re-forecast the current tick twice from there.
    tickState(charged);
    tickState(control);
    const chargeTick = getTimeFromTimeline(
      charged.date.minute,
      charged.timeline,
    )!;
    const controlTick = getTimeFromTimeline(
      control.date.minute,
      control.timeline,
    )!;
    expect(chargeTick.expensesOM - controlTick.expensesOM).toBeCloseTo(
      deductible,
      0,
    );
    const oil = charged.facilities.find((f) => f.fuel === "Oil")!.id;
    [charged, control] = [charged, control].map((s) =>
      dispatch(dispatch(s, togglePauseFacility(oil)), togglePauseFacility(oil)),
    );
    tickToMonth(charged, HAIL.month + 1);
    tickToMonth(control, HAIL.month + 1);
    const cashGap =
      getTimeFromTimeline(control.date.minute, control.timeline)!.cash -
      getTimeFromTimeline(charged.date.minute, charged.timeline)!.cash;
    // Whole-dollar cash rounding each tick is the only slack.
    expect(Math.abs(cashGap - deductible)).toBeLessThan(200);
    const lifetimeGap = hits.reduce((total, hit) => {
      const id = hit.attributes.facilityId;
      const a = charged.facilities.find((f) => f.id === id)!;
      const b = control.facilities.find((f) => f.id === id)!;
      return total + a.lifetimeExpenses - b.lifetimeExpenses;
    }, 0);
    expect(lifetimeGap).toBeCloseTo(deductible, 0);
  });

  it("caps damaged output until the repair ends, then restores it once", () => {
    const { state, hits } = atHailOnset();
    const hit = hits[0];
    const id = hit.attributes.facilityId as number;
    const multiplier = 1 - Number(hit.attributes.damagedFraction);
    const facility = () => state.facilities.find((f) => f.id === id)!;
    while (state.date.minute < hit.endsMinute - TICK_MINUTES) {
      tickState(state);
      expect(facility().currentW).toBeLessThanOrEqual(
        facility().peakW * multiplier * (1 + 1e-9) + 1,
      );
      expect(facilityHazardStatus(state, facility())).toBeDefined();
    }
    tickToMinute(state, hit.endsMinute);
    expect(facilityHazardStatus(state, facility())).toBeUndefined();
    const repaired = (s: GameType) =>
      s.eventLog.filter((e) => e.storyPhaseKey === hit.key);
    expect(repaired(state)).toHaveLength(1);
    expect(repaired(state)[0].message).toContain("back to full output");
    tickToMinute(state, hit.endsMinute + MINUTES_PER_MONTH);
    expect(repaired(state)).toHaveLength(1);
  });

  it("lets a damaged facility be sold mid-repair", () => {
    const { state, hits } = atHailOnset();
    const id = hits[0].attributes.facilityId as number;
    const sold = dispatch(state, sellFacility(id));
    expect(sold.facilities.some((f) => f.id === id)).toBe(false);
    tickToMinute(sold, hits[0].endsMinute + MINUTES_PER_MONTH);
    expect(sold.eventLog.some((e) => e.storyPhaseKey === hits[0].key)).toBe(
      false,
    );
    const now = getTimeFromTimeline(sold.date.minute, sold.timeline)!;
    expect(Number.isFinite(now.cash)).toBe(true);
  });

  it("resumes a save mid-repair without repeating the storm or its deductible", () => {
    const { state } = atHailOnset();
    const continued = cloneDeep(state);
    const saved = parseSave(JSON.parse(JSON.stringify(serializeSave(state))));
    expect(saved).not.toBeNull();
    const restored = cloneDeep(gameReducer(undefined, resume(saved!.game)));
    tickToMonth(continued, HAIL.month + 3);
    tickToMonth(restored, HAIL.month + 3);
    expect(restored.worldEvents.occurrences).toEqual(
      continued.worldEvents.occurrences,
    );
    expect(restored.monthlyHistory).toEqual(continued.monthlyHistory);
    // Through JSON both ways, since a save drops undefined fields and Infinity.
    expect(JSON.parse(JSON.stringify(restored.facilities))).toEqual(
      JSON.parse(JSON.stringify(continued.facilities)),
    );
    expect(restored.eventLog.map((e) => e.message)).toEqual(
      continued.eventLog.map((e) => e.message),
    );
  });

  it("books insurance premiums as fixed upkeep, cut by hail-resistant panels", () => {
    const state = game(DENVER, HAIL.seed);
    const solar = state.facilities.filter((f) => f.fuel === "Sun");
    solar.forEach((f) =>
      expect(
        (f as { annualInsuranceCost?: number }).annualInsuranceCost,
      ).toBeGreaterThan(0),
    );
    const gas = state.facilities.find((f) => f.fuel === "Natural Gas")!;
    expect(
      (gas as { annualInsuranceCost?: number }).annualInsuranceCost,
    ).toBeUndefined();
    const before = (solar[0] as { annualInsuranceCost?: number })
      .annualInsuranceCost!;
    const retrofitted = dispatch(
      state,
      retrofitFacility({ facilityId: solar[0].id, upgrade: "hailResistant" }),
    );
    const after = retrofitted.facilities.find((f) => f.id === solar[0].id) as {
      annualInsuranceCost?: number;
    };
    expect(after.annualInsuranceCost).toBeLessThan(before);
  });
});

describe("retrofits", () => {
  it("charges the cost once, records it, and rejects a repeat", () => {
    const state = game(DENVER, HAIL.seed);
    tickToMonth(state, 1);
    const solar = state.facilities.find((f) => f.fuel === "Sun")!;
    const cost = retrofitCost(solar, state, "hailResistant")!;
    expect(cost).toBeGreaterThan(0);
    const cashBefore = getTimeFromTimeline(
      state.date.minute,
      state.timeline,
    )!.cash;
    const next = dispatch(
      state,
      retrofitFacility({ facilityId: solar.id, upgrade: "hailResistant" }),
    );
    const at = getTimeFromTimeline(next.date.minute, next.timeline)!;
    expect(cashBefore - at.cash).toBe(cost);
    expect(
      next.facilities.find((f) => f.id === solar.id)!.resilience?.hailResistant,
    ).toBe(true);
    expect(next.replayLog?.at(-1)?.type).toBe("retrofitFacility");
    // A repeat is not offered and changes nothing.
    // Immer freezes an unchanged base, so each probe works on its own copy.
    const repeated = dispatch(
      cloneDeep(next),
      retrofitFacility({ facilityId: solar.id, upgrade: "hailResistant" }),
    );
    expect(
      getTimeFromTimeline(repeated.date.minute, repeated.timeline)!.cash,
    ).toBe(at.cash);
    expect(repeated.replayLog).toEqual(next.replayLog);
    // Wrong technology, unknown facility and malformed payloads are rejected.
    const gas = next.facilities.find((f) => f.fuel === "Natural Gas")!;
    [
      { facilityId: gas.id, upgrade: "hailResistant" },
      { facilityId: 99999, upgrade: "hailResistant" },
      { facilityId: solar.id, upgrade: "bogus" },
    ].forEach((payload) => {
      const rejected = dispatch(
        cloneDeep(next),
        retrofitFacility(payload as Parameters<typeof retrofitFacility>[0]),
      );
      expect(rejected.replayLog).toEqual(next.replayLog);
    });
    // The next tick does not charge it again.
    const control = cloneDeep(next);
    tickState(next);
    control.worldEvents.occurrences = control.worldEvents.occurrences.filter(
      (e) => e.attributes.retrofit !== true,
    );
    tickState(control);
    expect(
      getTimeFromTimeline(next.date.minute, next.timeline)!.expensesOM,
    ).toBeCloseTo(
      getTimeFromTimeline(control.date.minute, control.timeline)!.expensesOM,
      6,
    );
  });

  it("refuses a retrofit the company cannot afford", () => {
    const state = game(DENVER, HAIL.seed);
    tickToMonth(state, 1);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    now.cash = 1;
    const solar = state.facilities.find((f) => f.fuel === "Sun")!;
    const next = dispatch(
      state,
      retrofitFacility({ facilityId: solar.id, upgrade: "hailResistant" }),
    );
    expect(
      next.facilities.find((f) => f.id === solar.id)!.resilience?.hailResistant,
    ).toBeFalsy();
  });

  it("replays a retrofit identically", () => {
    // Replays rebuild an authored scenario by id; 105 starts with a solar farm.
    const authored = SCENARIOS.find((s) => s.id === 105)!;
    const scenario = {
      ...authored,
      locationId: "Denver",
      location: getSimLocation("Denver"),
    };
    let played = createGame({ scenarioId: 105, scenario, seed: 4242 });
    tickToMonth(played, 2);
    const solar = played.facilities.find((f) => f.fuel === "Sun")!;
    played = dispatch(
      played,
      retrofitFacility({ facilityId: solar.id, upgrade: "hailResistant" }),
    );
    tickToMonth(played, 5);
    const replay = decodeReplay(
      JSON.parse(JSON.stringify(encodeReplay(serializeReplay(played)!))),
    )!;
    expect(replay.actions.map((a) => a.type)).toContain("retrofitFacility");
    const watched = createGameFromReplay(replay);
    tickToMonth(watched, 5);
    expect(watched.facilities).toEqual(played.facilities);
    expect(watched.monthlyHistory).toEqual(played.monthlyHistory);
    expect(watched.worldEvents.occurrences).toEqual(
      played.worldEvents.occurrences,
    );
  });
});

describe("extreme cold", () => {
  // Minneapolis gas is winterized by default. One plant is set back to the standard -8 °C rating,
  // as if bought without the package, so an ordinary deep winter derates it but not its neighbour.
  const MINNEAPOLIS = scenarioAt("Minneapolis", [
    { fuel: "Natural Gas", peakW: 600000000, initialAgeYears: 5 },
    { fuel: "Natural Gas", peakW: 300000000, initialAgeYears: 5 },
    { fuel: "Oil", peakW: 400000000, initialAgeYears: 5 },
  ]);

  it("derates only under-rated gas plants, for the month", () => {
    const state = game(MINNEAPOLIS, 11);
    const [standard, packaged] = state.facilities.filter(
      (f) => f.fuel === "Natural Gas",
    );
    expect(packaged.resilience?.coldWeatherPackage).toBe(true);
    standard.resilience = { coldWeatherPackage: false, designMinTempC: -8 };
    // Weather within the recorded years does not depend on the seed.
    const month = [0, 1, 11, 12, 13, 23, 24, 25].find(
      (m) =>
        representativeMinTempC(
          getDateFromMinute(m * MINUTES_PER_MONTH, state.startingYear),
          state.seed,
        ) < -9,
    );
    expect(month).toBeDefined();
    tickToMonth(state, month!);
    const key = hazardEventKey("EXTREME_COLD", "Minneapolis", month!);
    const snap = state.worldEvents.active.find((e) => e.key === key)!;
    expect(snap).toBeDefined();
    expect(snap.definitionId).toBe(COLD_DEFINITION_ID);
    expect(snap.endsMinute - snap.startsMinute).toBe(MINUTES_PER_MONTH);
    const minTempC = Number(snap.attributes.minTempC);
    const multipliers = snap.effects.facilityOutputMultipliersById || {};
    expect(multipliers[String(standard.id)]).toBeLessThan(1);
    expect(multipliers[String(standard.id)]).toBeGreaterThan(0);
    // Still warmer than the packaged plant's rating, so it rides the cold out.
    expect(minTempC).toBeGreaterThanOrEqual(-35);
    expect(multipliers[String(packaged.id)]).toBeUndefined();
    expect(snap.attributes.protectedFacilityIds).toContain(packaged.id);
    // Regional gas strain only below the location's threshold.
    expect(!!snap.effects.fuelPriceMultipliers).toBe(minTempC < -30);
    const logs = state.eventLog.filter((e) => e.storyPhaseKey === key);
    expect(logs).toHaveLength(1);
    expect(logs[0].importance).toBe("CRITICAL");
    expect(logs[0].message).toContain(standard.name);
    // Over at the next rollover, and not drawn twice.
    tickToMonth(state, month! + 1);
    expect(state.worldEvents.active.some((e) => e.key === key)).toBe(false);
    expect(
      state.worldEvents.occurrences.filter((e) => e.key === key),
    ).toHaveLength(1);
  });
});

describe("eligibility", () => {
  const anyHazard = (state: GameType) =>
    state.worldEvents.checkedKeys.some(
      (key) => key.startsWith("hail:") || key.startsWith("cold:"),
    );

  it("never draws generic cold in scenarios with an authored freeze", () => {
    WEATHER_HAZARD_AUTHORED_FREEZE_SCENARIOS.forEach((id) => {
      const state = createGame({ scenarioId: id, seed: 7 });
      expect(isWeatherHazardEligible(state, "EXTREME_COLD")).toBe(false);
      expect(isWeatherHazardEligible(state, "HAIL")).toBe(true);
      tickToMonth(state, 3);
      expect(
        state.worldEvents.checkedKeys.some((key) => key.startsWith("cold:")),
      ).toBe(false);
      expect(
        state.worldEvents.occurrences.some(
          (e) => e.definitionId === COLD_DEFINITION_ID,
        ),
      ).toBe(false);
    });
  });

  it("keeps every tutorial free of weather hazards", () => {
    WEATHER_HAZARD_TUTORIAL_SCENARIOS.forEach((id) => {
      const state = createGame({ scenarioId: id, seed: 7 });
      expect(isWeatherHazardEligible(state, "HAIL")).toBe(false);
      expect(isWeatherHazardEligible(state, "EXTREME_COLD")).toBe(false);
    });
    const tutorial = createGame({ scenarioId: 0, seed: 7 });
    tickToMonth(tutorial, 2);
    expect(anyHazard(tutorial)).toBe(false);
  });

  it("switches everything off with the harness flag", () => {
    let state = game(DENVER, HAIL.seed);
    state = dispatch(state, delta({ weatherHazardsDisabled: true }));
    tickToMonth(state, HAIL.month + 1);
    expect(anyHazard(state)).toBe(false);
    expect(hailOccurrences(state)).toHaveLength(0);
    state.facilities.forEach((f) =>
      expect(
        (f as { annualInsuranceCost?: number }).annualInsuranceCost,
      ).toBeUndefined(),
    );
  });
});
