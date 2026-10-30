import cloneDeep from "lodash.clonedeep";
import { getTimeFromTimeline, summarizeTimeline } from "../helpers/DateTime";
import { tickState } from "../reducers/Game";
import {
  ActiveWorldEventType,
  GameType,
  TickPresentFutureType,
} from "../Types";
import {
  checkMonth,
  checkTick,
  checkWeatherHazards,
  InvariantCollector,
} from "./Invariants";
import { HAIL_DEFINITION_ID } from "../helpers/Hazards";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { createGame } from "./Simulator";

let fixture: GameType;
let previous: TickPresentFutureType;

beforeAll(() => {
  fixture = createGame({ scenarioId: 103, seed: 12345 });
  tickState(fixture);
  previous = cloneDeep(
    getTimeFromTimeline(fixture.date.minute, fixture.timeline)!,
  );
  tickState(fixture);
});

function inspect(mutate?: (tick: TickPresentFutureType) => void) {
  const state = cloneDeep(fixture);
  const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
  mutate?.(now);
  const collector = new InvariantCollector();
  checkTick(collector, state, previous, now, "test tick", false);
  return collector;
}

it("accepts an unchanged pair of real consecutive ticks", () => {
  expect(inspect().getViolations()).toEqual([]);
});

it.each([
  ["demandW", NaN, "tick value is finite"],
  ["demandW", 0, "demand is positive"],
  ["expensesFuel", -1, "tick value is non-negative"],
  ["supplyW", 1e15, "generation, storage and trade balance supply"],
  ["cash", 1e15, "cash changes only by recorded revenue and expenses"],
] as const)("rejects corrupted %s (%s)", (field, value, rule) => {
  const collector = inspect((tick) => {
    tick[field] = value;
  });
  expect(collector.getViolations()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule, when: "test tick" }),
    ]),
  );
});

it("checks monthly totals independently of tick checks", () => {
  const month = summarizeTimeline(fixture.timeline, fixture.startingYear);
  const valid = new InvariantCollector();
  checkMonth(valid, month, "test month");
  expect(valid.getViolations()).toEqual([]);
  month.supplyWh = month.demandWh * 2;
  const invalid = new InvariantCollector();
  checkMonth(invalid, month, "test month");
  expect(invalid.getViolations()).toEqual([
    expect.objectContaining({ rule: "monthly supply never exceeds demand" }),
  ]);
});

it("caps reported examples without losing the total violation count", () => {
  const collector = new InvariantCollector();
  for (let index = 0; index < 20; index++) {
    collector.add("broken cash", `tick ${index}`, "cash mismatch");
  }
  collector.add("broken energy", "tick 20", "energy mismatch");
  expect(collector.getTotalCount()).toBe(21);
  expect(collector.getCountByRule()).toEqual({
    "broken cash": 20,
    "broken energy": 1,
  });
  expect(collector.getViolations()).toHaveLength(6);
  expect(collector.getViolations()[5].rule).toBe("broken energy");
});

describe("weather hazard checks", () => {
  function withHail(patch: (event: ActiveWorldEventType) => void) {
    const state = cloneDeep(fixture);
    const solar = state.facilities[0];
    solar.fuel = "Sun";
    const startsMinute = state.date.monthsElapsed * MINUTES_PER_MONTH;
    const event: ActiveWorldEventType = {
      key: `hail:test:${state.date.monthsElapsed}:f${solar.id}`,
      definitionId: HAIL_DEFINITION_ID,
      startsMinute,
      endsMinute: startsMinute + 600,
      attributes: {
        facilityId: solar.id,
        oneTimeCost: 1000,
        repairCost: 1000,
      },
      effects: { facilityOutputMultipliersById: { [String(solar.id)]: 0.8 } },
    };
    patch(event);
    state.worldEvents.active.push(event);
    const collector = new InvariantCollector();
    checkWeatherHazards(collector, state, "test month");
    return collector.getViolations().map(({ rule }) => rule);
  }

  it("accepts a well-formed hail occurrence", () => {
    expect(withHail(() => {})).toEqual([]);
  });

  it.each([
    [
      "a charge that differs from the repair",
      (e: ActiveWorldEventType) => {
        e.attributes.oneTimeCost = 5000;
      },
      "hail charge equals the repair cost",
    ],
    [
      "a derate outside (0, 1]",
      (e: ActiveWorldEventType) => {
        const byId = e.effects.facilityOutputMultipliersById!;
        byId[Object.keys(byId)[0]] = 0;
      },
      "weather hazard derates stay within (0, 1]",
    ],
  ])("flags %s", (_label, patch, rule) => {
    expect(withHail(patch)).toContain(rule);
  });

  it("flags hail on a non-solar facility", () => {
    expect(
      withHail((e) => {
        e.effects.facilityOutputMultipliersById = { "999999": 0.5 };
      }),
    ).toContain("hail only damages operating solar");
  });
});

it("accepts actual entitlement purchases and rejects a forged source-interface claim", () => {
  const state = createGame({ scenarioId: 116, seed: 12345 });
  tickState(state);
  const before = cloneDeep(
    getTimeFromTimeline(state.date.minute, state.timeline)!,
  );
  tickState(state);
  const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
  expect(now.entitlementImportedW).toBeGreaterThan(0);
  const valid = new InvariantCollector();
  checkTick(valid, state, before, now, "utility tick", false);
  expect(valid.getViolations()).toEqual([]);

  const corrupted = cloneDeep(now);
  corrupted.entitlementImportedW =
    (corrupted.entitlementImportCapacityW ?? 0) + 1e6;
  const invalid = new InvariantCollector();
  checkTick(invalid, state, before, corrupted, "corrupt purchase", false);
  expect(invalid.getViolations()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        rule: "purchased entitlements remain within source interfaces",
      }),
    ]),
  );

  const forgedArea = cloneDeep(now);
  forgedArea.areaTicks!.champlain!.entitlementImportCapacityW = 1e12;
  const invalidArea = new InvariantCollector();
  checkTick(invalidArea, state, before, forgedArea, "corrupt interface", false);
  expect(invalidArea.getViolations()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        rule: "each area's purchases respect its own dated source rights",
      }),
    ]),
  );
});

it("rejects invented curtailment instead of hiding an energy imbalance", () => {
  const collector = inspect((tick) => {
    tick.curtailedW = 1e9;
  });
  expect(collector.getViolations()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        rule: "curtailment accounts only for unused local output",
      }),
      expect.objectContaining({
        rule: "generation, storage and trade balance supply",
      }),
    ]),
  );
});

it.each([0, 5.960464477539063e-8, 1])(
  "distinguishes source purchases from outside imports when exporting (%s W outside import)",
  (outsideImportW) => {
    const state = createGame({ scenarioId: 116, seed: 12345 });
    tickState(state);
    const now = cloneDeep(
      getTimeFromTimeline(state.date.minute, state.timeline)!,
    );
    expect(now.entitlementImportedW).toBeGreaterThan(0);
    now.importedW = now.entitlementImportedW! + outsideImportW;
    now.exportedW = 1;
    now.revenueExports = 1;
    const collector = new InvariantCollector();
    checkTick(collector, state, null, now, "outside direction", false);
    expect(
      collector.getCountByRule()["a tick never imports and exports at once"],
    ).toBe(outsideImportW > 0 ? 1 : undefined);
  },
);
