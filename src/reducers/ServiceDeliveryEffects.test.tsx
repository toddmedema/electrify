import cloneDeep from "lodash.clonedeep";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { combineStoryEffects } from "../data/WorldEvents";
import {
  getDateFromMinute,
  MINUTES_PER_MONTH,
  summarizeHistory,
  summarizeTimeline,
} from "../helpers/DateTime";
import { createGame } from "../testing/Simulator";
import { generateNewTimeline } from "./Game";
import { emptyPolicies } from "../helpers/Policies";
import { customerBatteryFleet } from "../helpers/CustomerBatteries";

function fixture(backupWh: number) {
  const game = createGame({
    scenarioId: DEFAULT_CUSTOM_SCENARIO.id,
    scenario: DEFAULT_CUSTOM_SCENARIO,
    seed: 44,
  });
  game.date = getDateFromMinute(MINUTES_PER_MONTH, game.startingYear);
  const event = {
    key: `delivery:${backupWh}`,
    definitionId: "local-delivery",
    startsMinute: MINUTES_PER_MONTH,
    endsMinute: 2 * MINUTES_PER_MONTH,
    attributes: {},
    effects: {
      serviceInterruptionFraction: 0.1,
      localBackupWhPerMonth: backupWh,
    },
  };
  game.worldEvents.active.push(event);
  game.worldEvents.occurrences.push(event);
  return game;
}

it("keeps backup off grid dispatch and billing, recording its finite monthly service benefit", () => {
  const standard = fixture(0);
  const prepared = fixture(3.6e6);
  const run = (game: typeof standard) =>
    generateNewTimeline(game, 1e9, 2e6, 96);
  const a = run(standard);
  const b = run(prepared);
  expect(b.map((t) => t.demandW)).toEqual(a.map((t) => t.demandW));
  expect(b.map((t) => t.supplyW)).toEqual(a.map((t) => t.supplyW));
  expect(b.map((t) => t.revenue)).toEqual(a.map((t) => t.revenue));
  const base = summarizeTimeline(a, standard.startingYear);
  const result = summarizeTimeline(b, prepared.startingYear);
  expect(result.localBackupWh).toBeCloseTo(3.6e6, 4);
  expect(base.interruptedWh! - result.interruptedWh!).toBeCloseTo(3.6e6, 4);
  expect(result.supplyWh).toBe(base.supplyWh);
  expect(result.kgco2e - base.kgco2e).toBeCloseTo(2302.554464, 5);
  expect(summarizeHistory([result, result]).localBackupWh).toBeCloseTo(
    7.2e6,
    4,
  );
  const repeated = run(cloneDeep(prepared));
  expect(
    summarizeTimeline(repeated, prepared.startingYear).localBackupWh,
  ).toBeCloseTo(3.6e6, 4);
});

it("composes delivery isolation without exceeding all demand and adds backup budgets", () => {
  const effects = combineStoryEffects([
    {
      effects: { serviceInterruptionFraction: 0.5, localBackupWhPerMonth: 100 },
    },
    {
      effects: { serviceInterruptionFraction: 0.5, localBackupWhPerMonth: 200 },
    },
  ]);
  expect(effects.serviceInterruptionFraction).toBe(0.75);
  expect(effects.localBackupWhPerMonth).toBe(300);
});

it("ordinary rooftop PV cannot supply disconnected premises", () => {
  const standard = fixture(0);
  standard.date = getDateFromMinute(
    MINUTES_PER_MONTH + 12 * 60,
    standard.startingYear,
  );
  const solar = cloneDeep(standard);
  solar.policies = emptyPolicies(solar.date.monthsElapsed);
  solar.policies.programs.solar.adoption = 0.05;
  const baseline = generateNewTimeline(standard, 1e9, 2e6, 1)[0];
  const supplied = generateNewTimeline(solar, 1e9, 2e6, 1)[0];
  expect(supplied.rooftopSolarW).toBeGreaterThan(0);
  expect(supplied.disconnectedDemandW).toBeCloseTo(
    baseline.disconnectedDemandW!,
    6,
  );
  expect(baseline.demandW - supplied.demandW).toBeCloseTo(
    supplied.rooftopSolarW!,
    6,
  );
});

it("ordinary customer battery dispatch cannot erase an isolated customer's interruption", () => {
  const standard = fixture(0);
  standard.date = getDateFromMinute(
    MINUTES_PER_MONTH + 17 * 60,
    standard.startingYear,
  );
  const enrolled = cloneDeep(standard);
  enrolled.policies = emptyPolicies(enrolled.date.monthsElapsed);
  enrolled.policies.programs.battery = {
    tier: "On",
    adoption: 0.5,
    spending: 0,
    spent: 0,
    installs: [[0, 0.5]],
  };
  const battery = customerBatteryFleet(
    enrolled.policies.programs.battery,
    enrolled.date.monthsElapsed,
    enrolled.startingYear,
    enrolled.customerMarketSize,
    enrolled.location,
  );
  for (const tick of enrolled.timeline) {
    tick.customerBatteryWh = battery.capacityWh;
    tick.customerBatteryWhStart = battery.capacityWh;
  }
  const baseline = generateNewTimeline(standard, 1e9, 2e6, 1)[0];
  const supplied = generateNewTimeline(enrolled, 1e9, 2e6, 1)[0];
  expect(supplied.customerBatteryDischargeW).toBeGreaterThan(0);
  expect(supplied.demandW).toBeLessThan(baseline.demandW);
  expect(supplied.disconnectedDemandW).toBe(baseline.disconnectedDemandW);
});

it("uniform isolation preserves the delivered load's time-of-use discount proportions", () => {
  const isolated = fixture(0);
  isolated.date = getDateFromMinute(
    MINUTES_PER_MONTH + 21 * 60,
    isolated.startingYear,
  );
  isolated.policies = emptyPolicies(isolated.date.monthsElapsed);
  isolated.policies.programs.timeOfUse.tier = "On";
  isolated.timeline.at(-1)!.deferredResidential = [
    {
      energyWh: 1e6,
      recoveryStartMinute: isolated.date.minute,
      recoveryEndMinute: isolated.date.minute + 180,
    },
  ];
  const connected = cloneDeep(isolated);
  connected.worldEvents.active = [];
  connected.worldEvents.occurrences = [];
  const baseline = generateNewTimeline(connected, 1e9, 2e6, 1)[0];
  const supplied = generateNewTimeline(isolated, 1e9, 2e6, 1)[0];
  expect(baseline.shiftedResidentialW).toBeGreaterThan(0);
  expect(supplied.demandW / baseline.demandW).toBeCloseTo(0.9, 10);
  expect(
    supplied.shiftedResidentialW! / baseline.shiftedResidentialW!,
  ).toBeCloseTo(0.9, 10);
  expect(supplied.customerBillingRate).toBeCloseTo(
    baseline.customerBillingRate!,
    12,
  );
});
