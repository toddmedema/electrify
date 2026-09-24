import cloneDeep from "lodash.clonedeep";
import gameReducer, {
  cancelRetrofit,
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
    expect(logs[0].title).toBe("Hail damage");
    expect(logs[0].concept).toBe("severeWeather");
    expect(logs[0].message).toMatch(
      /^Hail damaged \d+% of your solar fleet\. Repairs cost \$[\d.]+[KMB]? and take about \d+ days?\.$/,
    );
    expect(state.speed).toBe("PAUSED");
    // Continuing the month does not announce or record the storm again.
    tickToMonth(state, HAIL.month + 1);
    expect(state.eventLog.filter((e) => e.storyPhaseKey === key)).toHaveLength(
      1,
    );
    expect(hailOccurrences(state)).toHaveLength(hits.length);
  });

  it("logs light damage to hail-resistant panels as minor", () => {
    const state = game(DENVER, HAIL.seed);
    state.facilities
      .filter((f) => f.fuel === "Sun")
      .forEach((f) => (f.resilience = { hailResistant: true }));
    tickToMonth(state, HAIL.month);
    const key = hazardEventKey("HAIL", "Denver", HAIL.month);
    const log = state.eventLog.find((e) => e.storyPhaseKey === key)!;
    expect(log.title).toBe("Minor hail damage");
    expect(log.message).toMatch(
      /^Hail-resistant panels held damage to \d+% of your solar fleet\. Repairs cost \$[\d.]+[KMB]? and take about \d+ days?\.$/,
    );
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

  it("charges each repair cost exactly once, even across a re-forecast", () => {
    const { state, hits } = atHailOnset();
    const repairCost = hits.reduce(
      (total, e) => total + Number(e.attributes.oneTimeCost),
      0,
    );
    expect(repairCost).toBeGreaterThan(0);
    // The control differs only in the repairCost, zeroed before it falls due.
    let control = cloneDeep(state);
    control.worldEvents.active.forEach((e) => {
      if (e.definitionId === HAIL_DEFINITION_ID) e.attributes.oneTimeCost = 0;
    });
    let charged = state;
    // One tick in the repairCost is booked; re-forecast the current tick twice from there.
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
      repairCost,
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
    expect(Math.abs(cashGap - repairCost)).toBeLessThan(200);
    const lifetimeGap = hits.reduce((total, hit) => {
      const id = hit.attributes.facilityId;
      const a = charged.facilities.find((f) => f.id === id)!;
      const b = control.facilities.find((f) => f.id === id)!;
      return total + a.lifetimeExpenses - b.lifetimeExpenses;
    }, 0);
    expect(lifetimeGap).toBeCloseTo(repairCost, 0);
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
    expect(repaired(state)[0].message).toBe(
      `${facility().name} is back to full output.`,
    );
    expect(repaired(state)[0].title).toBe("Hail repairs complete");
    tickToMinute(state, hit.endsMinute + MINUTES_PER_MONTH);
    expect(repaired(state)).toHaveLength(1);
  });

  it("reports overlapping storms together and completes repairs only after the last", () => {
    const { state, hits } = atHailOnset();
    const hit = hits[0];
    const id = hit.attributes.facilityId as number;
    // A second storm's damage on the same array, still under repair after the first ends.
    const second: ActiveWorldEventType = {
      ...cloneDeep(hit),
      key: `${hit.key}:second`,
      endsMinute: hit.endsMinute + MINUTES_PER_MONTH / 4,
      attributes: { ...hit.attributes, oneTimeCost: 0 },
      effects: { facilityOutputMultipliersById: { [String(id)]: 0.5 } },
    };
    state.worldEvents.active.push(second);
    const facility = () => state.facilities.find((f) => f.id === id)!;
    const status = facilityHazardStatus(state, facility())!;
    expect(status.availableFraction).toBeCloseTo(
      (1 - Number(hit.attributes.damagedFraction)) * 0.5,
      12,
    );
    expect(status.endsMinute).toBe(second.endsMinute);
    const completions = () =>
      state.eventLog.filter(
        (e) => e.message === `${facility().name} is back to full output.`,
      );
    tickToMinute(state, hit.endsMinute);
    expect(completions()).toHaveLength(0);
    expect(facilityHazardStatus(state, facility())?.availableFraction).toBe(
      0.5,
    );
    tickToMinute(state, second.endsMinute);
    expect(completions()).toHaveLength(1);
    expect(facilityHazardStatus(state, facility())).toBeUndefined();
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

  it("resumes a save mid-repair without repeating the storm or its repair cost", () => {
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
    // Installed over the next month, not at once
    const installing = next.facilities.find((f) => f.id === solar.id)!;
    expect(installing.resilience?.hailResistant).toBe(false);
    expect(installing.upgradeInProgress).toEqual({
      upgrade: "hailResistant",
      cost,
      startsMinute: next.date.minute,
      completesMinute: next.date.minute + MINUTES_PER_MONTH,
    });
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

  it("holds the plant offline for a month, then installs the upgrade", () => {
    const state = game(DENVER, HAIL.seed);
    tickToMonth(state, 1);
    const [solar, other] = state.facilities.filter((f) => f.fuel === "Sun");
    const next = dispatch(
      state,
      retrofitFacility({ facilityId: solar.id, upgrade: "hailResistant" }),
    );
    const completes = next.date.minute + MINUTES_PER_MONTH;
    let otherPeakW = 0;
    while (next.date.minute < completes - TICK_MINUTES) {
      tickState(next);
      expect(next.facilities.find((f) => f.id === solar.id)!.currentW).toBe(0);
      otherPeakW = Math.max(
        otherPeakW,
        next.facilities.find((f) => f.id === other.id)!.currentW,
      );
    }
    // The comparison array kept generating through the same daylight
    expect(otherPeakW).toBeGreaterThan(0);
    tickToMinute(next, completes + 12 * 60);
    const done = next.facilities.find((f) => f.id === solar.id)!;
    expect(done.upgradeInProgress).toBeUndefined();
    expect(done.resilience?.hailResistant).toBe(true);
    expect(
      next.eventLog.some((e) => e.message.startsWith("Upgrade complete:")),
    ).toBe(true);
    // Back in service: it generates again once the sun is up
    let peakW = 0;
    tickToMinute(next, completes + MINUTES_PER_MONTH / 2);
    for (let i = 0; i < 24 * 4; i++) {
      tickState(next);
      peakW = Math.max(
        peakW,
        next.facilities.find((f) => f.id === solar.id)!.currentW,
      );
    }
    expect(peakW).toBeGreaterThan(0);
  });

  it("cancels for a full refund and returns the plant to service at once", () => {
    const state = game(DENVER, HAIL.seed);
    tickToMonth(state, 1);
    tickToMinute(state, state.date.minute + 12 * 60);
    // Denver winterizes gas by default; start from one bought without the package
    const gas = state.facilities.find((f) => f.fuel === "Natural Gas")!;
    gas.resilience = { coldWeatherPackage: false, designMinTempC: -8 };
    const control = cloneDeep(state);
    const cost = retrofitCost(gas, state, "coldWeatherPackage")!;
    expect(cost).toBeGreaterThan(0);
    const started = dispatch(
      state,
      retrofitFacility({ facilityId: gas.id, upgrade: "coldWeatherPackage" }),
    );
    tickState(started);
    tickState(control);
    expect(
      started.facilities.find((f) => f.id === gas.id)!.upgradeInProgress,
    ).toBeDefined();
    const cancelled = dispatch(started, cancelRetrofit(gas.id));
    const plant = cancelled.facilities.find((f) => f.id === gas.id)!;
    expect(plant.upgradeInProgress).toBeUndefined();
    expect(plant.resilience?.coldWeatherPackage).toBeFalsy();
    expect(cancelled.replayLog?.at(-1)?.type).toBe("cancelRetrofit");
    expect(
      cancelled.eventLog.some((e) => e.message.startsWith("Cancelled")),
    ).toBe(true);
    // Cash ends where it would have been had the player never started it, give or take the
    // one tick of lost output
    const cashNow = (s: GameType) =>
      getTimeFromTimeline(s.date.minute, s.timeline)!.cash;
    expect(Math.abs(cashNow(cancelled) - cashNow(control))).toBeLessThan(
      cost * 0.05,
    );
    // A second cancel, or one for a plant that isn't upgrading, changes nothing
    const again = dispatch(cloneDeep(cancelled), cancelRetrofit(gas.id));
    expect(again.replayLog).toEqual(cancelled.replayLog);
    expect(cashNow(again)).toBe(cashNow(cancelled));
    // The refunded plant runs like one that was never upgraded
    for (let i = 0; i < 8; i++) {
      tickState(cancelled);
      tickState(control);
    }
    expect(
      cancelled.facilities.find((f) => f.id === gas.id)!.currentW,
    ).toBeCloseTo(control.facilities.find((f) => f.id === gas.id)!.currentW, 0);
  });

  it("saves and resumes after a retrofit exactly like an uninterrupted run", () => {
    const state = game(DENVER, HAIL.seed);
    tickToMonth(state, 1);
    const solar = state.facilities.find((f) => f.fuel === "Sun")!;
    const retrofitted = dispatch(
      state,
      retrofitFacility({ facilityId: solar.id, upgrade: "hailResistant" }),
    );
    expect(retrofitted.meaningfulDecisions.at(-1)).toMatchObject({
      lever: `resilience:${solar.id}:hail-resistant`,
      after: "hail-resistant",
    });
    const continued = cloneDeep(retrofitted);
    const saved = parseSave(
      JSON.parse(JSON.stringify(serializeSave(retrofitted))),
    );
    expect(saved).not.toBeNull();
    const restored = cloneDeep(gameReducer(undefined, resume(saved!.game)));
    tickToMonth(continued, 3);
    tickToMonth(restored, 3);
    expect(restored.meaningfulDecisions).toEqual(continued.meaningfulDecisions);
    expect(restored.monthlyHistory).toEqual(continued.monthlyHistory);
    expect(JSON.parse(JSON.stringify(restored.facilities))).toEqual(
      JSON.parse(JSON.stringify(continued.facilities)),
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
    // Try it, cancel for a refund, then commit to it
    played = dispatch(
      played,
      retrofitFacility({ facilityId: solar.id, upgrade: "hailResistant" }),
    );
    tickToMinute(played, played.date.minute + 4 * 60);
    played = dispatch(played, cancelRetrofit(solar.id));
    tickToMinute(played, played.date.minute + 60);
    played = dispatch(
      played,
      retrofitFacility({ facilityId: solar.id, upgrade: "hailResistant" }),
    );
    tickToMonth(played, 5);
    expect(
      played.facilities.find((f) => f.id === solar.id)!.resilience
        ?.hailResistant,
    ).toBe(true);
    const replay = decodeReplay(
      JSON.parse(JSON.stringify(encodeReplay(serializeReplay(played)!))),
    )!;
    expect(replay.actions.map((a) => a.type)).toEqual(
      expect.arrayContaining(["retrofitFacility", "cancelRetrofit"]),
    );
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
    expect(minTempC).toBeGreaterThanOrEqual(-34);
    expect(multipliers[String(packaged.id)]).toBeUndefined();
    expect(snap.attributes.protectedFacilityIds).toContain(packaged.id);
    // Regional gas strain only below the location's threshold.
    expect(!!snap.effects.fuelPriceMultipliers).toBe(minTempC < -29);
    const logs = state.eventLog.filter((e) => e.storyPhaseKey === key);
    expect(logs).toHaveLength(1);
    expect(logs[0].importance).toBe("CRITICAL");
    expect(logs[0].title).toBe("Extreme cold");
    expect(logs[0].concept).toBe("severeWeather");
    expect(logs[0].message).toContain(standard.name);
    // The log cannot follow the player's unit setting, so it names no temperature.
    expect(logs[0].message).not.toMatch(/°|\d+ ?C\b/);
    // Over at the next rollover, and not drawn twice.
    tickToMonth(state, month! + 1);
    expect(state.worldEvents.active.some((e) => e.key === key)).toBe(false);
    expect(
      state.worldEvents.occurrences.filter((e) => e.key === key),
    ).toHaveLength(1);
  });
});

describe("selling a plant during a cold snap", () => {
  it("does not leave its derate cached for a plant that reuses the ID", () => {
    const MINNEAPOLIS = scenarioAt("Minneapolis", [
      { fuel: "Natural Gas", peakW: 600000000, initialAgeYears: 5 },
      { fuel: "Oil", peakW: 400000000, initialAgeYears: 5 },
    ]);
    const state = game(MINNEAPOLIS, 11);
    const gas = state.facilities.find((f) => f.fuel === "Natural Gas")!;
    gas.resilience = { coldWeatherPackage: false, designMinTempC: -8 };
    const month = [0, 1, 11, 12, 13, 23, 24, 25].find(
      (m) =>
        representativeMinTempC(
          getDateFromMinute(m * MINUTES_PER_MONTH, state.startingYear),
          state.seed,
        ) < -9,
    )!;
    tickToMonth(state, month);
    const snap = state.worldEvents.active.find(
      (e) => e.key === hazardEventKey("EXTREME_COLD", "Minneapolis", month),
    )!;
    const multiplier =
      snap.effects.facilityOutputMultipliersById![String(gas.id)];
    expect(multiplier).toBeLessThan(0.9);
    // Run a few ticks so the month's effects are cached with the derate.
    for (let i = 0; i < 4; i++) tickState(state);
    const sold = dispatch(state, sellFacility(gas.id));
    // A new, unrated plant under the same ID, running alone against the city's load.
    sold.facilities.forEach((f) => (f.paused = true));
    sold.facilities.unshift({
      ...cloneDeep(gas),
      minuteCreated: sold.date.minute,
      paused: false,
    });
    let peakW = 0;
    for (let i = 0; i < 24; i++) {
      tickState(sold);
      peakW = Math.max(
        peakW,
        sold.facilities.find((f) => f.id === gas.id)!.currentW,
      );
    }
    expect(peakW).toBeGreaterThan(gas.peakW * multiplier * 1.05);
  });
});

describe("extreme cold gas prices", () => {
  const DALLAS = scenarioAt("Dallas", [
    { fuel: "Natural Gas", peakW: 600000000, initialAgeYears: 5 },
    { fuel: "Oil", peakW: 400000000, initialAgeYears: 5 },
  ]);

  /** A Dallas run whose next month carries an injected story freeze and gas shock. */
  function withStory(gasMultiplier: number | undefined) {
    const state = game(DALLAS, 5);
    const month = 1;
    state.worldEvents.active.push({
      // Story effects are cached by occurrence key, so each variant needs its own.
      key: `test-freeze-${gasMultiplier ?? 1}`,
      definitionId: "test-freeze",
      startsMinute: month * MINUTES_PER_MONTH,
      endsMinute: (month + 1) * MINUTES_PER_MONTH,
      attributes: {},
      effects: {
        temperatureOffsetC: -40,
        ...(gasMultiplier
          ? { fuelPriceMultipliers: { "Natural Gas": gasMultiplier } }
          : {}),
      },
    });
    tickToMonth(state, month);
    const snap = state.worldEvents.active.find(
      (e) => e.key === hazardEventKey("EXTREME_COLD", "Dallas", month),
    )!;
    return { state, snap };
  }

  it("spikes gas in a rare mild-climate freeze and says so plainly", () => {
    const { state, snap } = withStory(undefined);
    expect(snap.attributes.regional).toBe(true);
    const multiplier = snap.effects.fuelPriceMultipliers?.["Natural Gas"]!;
    expect(multiplier).toBe(3);
    const log = state.eventLog.find((e) => e.storyPhaseKey === snap.key)!;
    // The title already says "Extreme cold"; one plant is limited to a plain share.
    expect(log.title).toBe("Extreme cold");
    expect(log.message).toMatch(
      /^Gas prices are 3\.0× normal this month as regional supply strains; .+ is limited to \d+% output\.$/,
    );
    expect(log.message).not.toContain("as little as");
  });

  it("caps the combined story and cold gas multiple", () => {
    const { state, snap } = withStory(2.5);
    const cold = snap.effects.fuelPriceMultipliers?.["Natural Gas"]!;
    expect(cold).toBeCloseTo(3 / 2.5, 12);
    expect(snap.attributes.gasPriceMultiplier).toBeCloseTo(3 / 2.5, 12);
    // A story shock already at the cap leaves nothing for the cold to add.
    const capped = withStory(3.5).snap;
    expect(capped.attributes.regional).toBe(true);
    expect(capped.effects.fuelPriceMultipliers).toBeUndefined();
    const log = state.eventLog.find((e) => e.storyPhaseKey === snap.key)!;
    expect(log.message).toContain("1.2× normal");
  });
});

describe("month-end transactions", () => {
  it("charges a retrofit on a month's last tick exactly once", () => {
    const state = game(DENVER, HAIL.seed);
    tickToMinute(state, 2 * MINUTES_PER_MONTH - TICK_MINUTES);
    expect(state.date.monthsElapsed).toBe(1);
    const control = cloneDeep(state);
    const solar = state.facilities.find((f) => f.fuel === "Sun")!;
    const cost = retrofitCost(solar, state, "hailResistant")!;
    const retrofitted = dispatch(
      state,
      retrofitFacility({ facilityId: solar.id, upgrade: "hailResistant" }),
    );
    expect(
      retrofitted.facilities.find((f) => f.id === solar.id)!.upgradeInProgress
        ?.upgrade,
    ).toBe("hailResistant");
    // The rollover tick clamps prev and now to the month's final frame.
    tickState(retrofitted);
    tickState(control);
    expect(retrofitted.date.monthsElapsed).toBe(2);
    const cashGap = control.timeline[0].cash - retrofitted.timeline[0].cash;
    // Whole-dollar cash rounding each tick is the only slack.
    expect(Math.abs(cashGap - cost)).toBeLessThan(cost * 0.001);
    // The closed month's history reports it as an expense exactly once, too.
    const expenseGap =
      retrofitted.monthlyHistory[0].expensesOM -
      control.monthlyHistory[0].expensesOM;
    expect(Math.abs(expenseGap - cost)).toBeLessThan(cost * 0.001);
  });
});

describe("selling a facility under a weather outage", () => {
  it("ends its outage so a facility reusing the ID starts clean", () => {
    const { state, hits } = atHailOnset();
    const id = hits[0].attributes.facilityId as number;
    const sold = dispatch(state, sellFacility(id));
    const covering = sold.worldEvents.active.filter(
      (e) =>
        e.effects.facilityOutputMultipliersById?.[String(id)] !== undefined,
    );
    expect(covering).toEqual([]);
    const ended = sold.worldEvents.active.find((e) => e.key === hits[0].key)!;
    expect(ended.endsMinute).toBeLessThanOrEqual(sold.date.minute);
    // The incurred repair cost is still due; the historical record is untouched.
    expect(ended.attributes.oneTimeCost).toBe(hits[0].attributes.oneTimeCost);
    expect(
      sold.worldEvents.occurrences.find((e) => e.key === hits[0].key),
    ).toEqual(hits[0]);
    // A new facility with the same ID is not limited and gets no repair log.
    const reused = {
      ...state.facilities.find((f) => f.id === id)!,
      minuteCreated: sold.date.minute,
    };
    sold.facilities.push(reused);
    expect(facilityHazardStatus(sold, reused)).toBeUndefined();
    tickToMinute(sold, hits[0].endsMinute + TICK_MINUTES);
    expect(sold.eventLog.some((e) => e.storyPhaseKey === hits[0].key)).toBe(
      false,
    );
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
    const state = dispatch(
      game(DENVER, HAIL.seed),
      delta({ weatherHazardsDisabled: true }),
    );
    tickToMonth(state, HAIL.month + 1);
    expect(anyHazard(state)).toBe(false);
    expect(hailOccurrences(state)).toHaveLength(0);
  });
});
