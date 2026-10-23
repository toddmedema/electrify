import cloneDeep from "lodash.clonedeep";
import { DIFFICULTY_IDS, TICKS_PER_MONTH } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { resolveStoryAtDate, upcomingStoryPhases } from "../data/WorldEvents";
import type { RuleEvent } from "../data/ScenarioRules";
import * as officialCatalog from "../data/OfficialScenarioRules";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "../helpers/DateTime";
import { buildStorySnapshot } from "../helpers/Story";
import { validScenarioRuleState } from "../helpers/ScenarioRuleValidation";
import { scenarioRuleTargetOperations } from "../helpers/ScenarioRuleRuntime";
import { modScenario } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame, runSimulation } from "../testing/Simulator";
import type { DifficultyType, GameType, GeneratorShoppingType } from "../Types";
import reducer, {
  buildFacility,
  delta,
  generateNewTimeline,
  sellFacility,
  tickState,
  togglePauseFacility,
} from "./Game";

const pack = (events: RuleEvent[] = []): ModPackage => ({
  schemaVersion: 1,
  gameApi: 1,
  id: "runtime-fixture",
  title: "Runtime fixture",
  creator: "Fixture",
  version: "1",
  description: "A small grid for event boundaries.",
  seed: 42,
  baseScenarioId: 999,
  objectives: [],
  officialArcs: [],
  scenario: {
    durationMonths: 6,
    cash: 1e9,
    startingCustomers: 10000,
    dollarsPerkWh: 0.2,
    feePerKgCO2e: 0.1,
  },
  events,
});
const event = (patch: Partial<RuleEvent> = {}): RuleEvent => ({
  id: "change",
  title: "Grid change",
  message: "The grid changes.",
  preview: "The grid will change.",
  startMonth: 1,
  durationMonths: 1,
  ...patch,
});

test("a legal large fleet's frozen targets retain every asset through save validation", () => {
  const state = game(
    pack([
      event({
        startMonth: 2,
        durationMonths: 2,
        effects: {
          outputMultipliersBySelector: [
            {
              target: {
                selector: "operatingAtLeastAge",
                fuel: "Natural Gas",
                minAgeYears: 0,
              },
              outputMultiplier: 0.5,
            },
          ],
        },
      }),
    ]),
  );
  const source = state.facilities.find(
    (facility) => facility.fuel === "Natural Gas",
  )!;
  state.facilities = Array.from({ length: 1601 }, (_, index) => ({
    ...cloneDeep(source),
    id: index + 1,
    startingAssetId: undefined,
    name: `Plant ${index + 1}`,
  }));
  // Enter the boundary through the real owner without playing 1601 facilities for a full month.
  state.date = getDateFromMinute(MINUTES_PER_MONTH - 15, state.startingYear);
  state.timeline = generateNewTimeline(
    state,
    now(state).cash,
    now(state).customers,
  );
  tickState(state);
  expect(occurrence(state).attributes.selectedFacilityIds).toHaveLength(1601);
  expect(
    String(occurrence(state).attributes.ruleTargets).length,
  ).toBeGreaterThan(100000);
  expect(validScenarioRuleState(state)).toBe(true);
  const restored = parseSave(serializeSave(state));
  expect(restored).not.toBeNull();
  expect(
    restored!.game.worldEvents.occurrences.find(
      (item) => item.key === key("change"),
    )!.attributes.selectedFacilityIds,
  ).toHaveLength(1601);
});

test("commuting operation order cannot change persisted target associations in a transferred snapshot", () => {
  const state = game(
    pack([
      event({
        effects: {
          outputMultipliersBySelector: [
            { target: { selector: "largestOperating" }, outputMultiplier: 0.2 },
            {
              target: {
                selector: "oldestOperating",
                fuel: "Natural Gas",
                count: 1,
              },
              outputMultiplier: 0.7,
            },
          ],
        },
      }),
    ]),
  );
  const before = resolveStoryAtDate(context(state)).effects;
  const definitions = state.customScenario!.mod!.rules.events[0];
  const expected = scenarioRuleTargetOperations(definitions);
  definitions.targets.reverse();
  expect(scenarioRuleTargetOperations(definitions)).toEqual(expected);
  expect(validScenarioRuleState(state)).toBe(true);
  expect(resolveStoryAtDate(context(state)).effects).toEqual(before);
  expect(parseSave(serializeSave(state))).not.toBeNull();
});

test("imported freeze protection requires a committed paid response", () => {
  const scenario = modScenario({
    ...pack(),
    baseScenarioId: 107,
    scenario: { cash: 1e12 },
    officialArcs: [{ scenarioId: 107, includeChoices: false }],
  });
  const state = createGame({
    scenarioId: 999,
    scenario,
    difficulty: "Employee",
    seed: scenario.seed,
    weatherHazardsEnabled: false,
  });
  advance(state, 49);
  expect(validScenarioRuleState(state)).toBe(true);
  const freeze = state.worldEvents.occurrences.find((item) =>
    item.key.endsWith(":uri"),
  )!;
  expect(freeze.attributes.ruleProtectionFactor).toBe(0);
  freeze.attributes.ruleProtectionFactor = 1;
  state.worldEvents.active.find(
    (item) => item.key === freeze.key,
  )!.attributes.ruleProtectionFactor = 1;
  expect(validScenarioRuleState(state)).toBe(false);
});

function game(input = pack(), difficulty: DifficultyType = "Employee") {
  const scenario = modScenario(input, undefined, difficulty);
  return createGame({
    scenarioId: 999,
    scenario,
    seed: input.seed,
    difficulty,
    weatherHazardsEnabled: false,
  });
}
const now = (state: GameType) =>
  getTimeFromTimeline(state.date.minute, state.timeline)!;
const recorded = (state: GameType) => JSON.parse(JSON.stringify(now(state)));
function advance(state: GameType, month: number) {
  while (state.date.monthsElapsed < month) tickState(state);
}
const key = (id: string) => `mod:runtime-fixture:${id}`;
const occurrence = (state: GameType, id = "change") =>
  state.worldEvents.occurrences.find((item) => item.key === key(id))!;
function context(state: GameType, month = state.date.monthsElapsed) {
  return {
    seed: state.seed,
    scenarioId: state.scenarioId,
    difficulty: state.difficulty,
    location: state.location,
    date: getDateFromMinute(month * MINUTES_PER_MONTH, state.startingYear),
    snapshot: buildStorySnapshot(
      state.monthlyHistory,
      state.facilities,
      state.date.minute,
    ),
    rules: state.customScenario!.mod!.rules,
    occurrences: state.worldEvents.occurrences,
    monthlyHistory: state.monthlyHistory,
    completedMonths: state.date.monthsElapsed,
  };
}
function restore(state: GameType) {
  const saved = parseSave(JSON.parse(JSON.stringify(serializeSave(state))));
  expect(saved).not.toBeNull();
  return cloneDeep(saved!.game);
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("month-one zero output and zero carbon fee apply before the first playable tick", () => {
  const state = game(
    pack([
      event({
        effects: {
          outputMultipliersByFuel: { "Natural Gas": 0 },
          carbonFeeDollarsPerTonneCO2e: 0,
        },
      }),
    ]),
  );
  expect(occurrence(state)).toMatchObject({
    startsMinute: 0,
    endsMinute: MINUTES_PER_MONTH,
  });
  expect(now(state).supplyW).toBe(0);
  expect(now(state).expensesCarbonFee).toBe(0);
  tickState(state);
  expect(now(state).supplyW).toBe(0);
  expect(now(state).expensesCarbonFee).toBe(0);
  expect(resolveStoryAtDate(context(state)).effects.carbonFeePerKgCO2e).toBe(0);
  advance(state, 1);
  expect(
    resolveStoryAtDate(context(state)).effects.carbonFeePerKgCO2e,
  ).toBeUndefined();
  expect(state.timeline.some((tick) => tick.supplyW > 0)).toBe(true);
});

test("opening charges and grants book once as company accounting through reforecast, save and month close", () => {
  const effects = {
    outputMultipliersByFuel: { "Natural Gas": 0 },
    carbonFeeDollarsPerTonneCO2e: 0,
  };
  const baseline = game(pack([event({ effects })]));
  let live = game(
    pack([
      event({
        effects: {
          ...effects,
          transactions: [
            { kind: "grant", amountDollars: 10000 },
            { kind: "charge", amountDollars: 2000 },
          ],
        },
      }),
    ]),
  );
  expect(now(live).cash - now(baseline).cash).toBe(8000);
  expect(now(live).revenueGrants).toBe(10000);
  expect(now(live).revenue - now(baseline).revenue).toBe(10000);
  expect(now(live).expensesOM - now(baseline).expensesOM).toBe(2000);
  const before = cloneDeep(now(live));
  live = cloneDeep(reducer(live, delta({ dollarsPerkWh: live.dollarsPerkWh })));
  expect(now(live).cash).toBe(before.cash);
  expect(now(live).revenue).toBe(before.revenue);
  expect(now(live).revenueGrants).toBe(before.revenueGrants);
  const resumed = restore(live);
  tickState(live);
  tickState(resumed);
  expect(now(live).revenueGrants).toBe(0);
  expect(recorded(resumed)).toEqual(recorded(live));
  advance(live, 1);
  advance(resumed, 1);
  advance(baseline, 1);
  expect(live.monthlyHistory[0].revenueGrants).toBe(10000);
  expect(
    live.monthlyHistory[0].expensesOM - baseline.monthlyHistory[0].expensesOM,
  ).toBeCloseTo(2000, 5);
  expect(resumed.monthlyHistory).toEqual(live.monthlyHistory);
  expect(
    live.worldEvents.occurrences.filter((item) => item.key === key("change")),
  ).toHaveLength(1);
});

test("a later receipt survives save immediately before and after activation without double booking", () => {
  const input = pack([
    event({
      startMonth: 2,
      effects: { transactions: [{ kind: "grant", amountDollars: 10000 }] },
    }),
  ]);
  const live = game(input),
    before = restore(live);
  advance(live, 1);
  advance(before, 1);
  expect(now(live).revenueGrants).toBe(10000);
  expect(recorded(before)).toEqual(recorded(live));
  const after = restore(live);
  tickState(live);
  tickState(after);
  expect(now(live).revenueGrants).toBe(0);
  expect(recorded(after)).toEqual(recorded(live));
  expect(
    after.worldEvents.occurrences.filter((item) => item.key === key("change")),
  ).toHaveLength(1);
});

test("known future money appears once in the same forecast frame as live activation", () => {
  const state = game(
    pack([
      event({
        startMonth: 2,
        durationMonths: 1,
        effects: {
          transactions: [
            { kind: "grant", amountDollars: 10000 },
            { kind: "charge", amountDollars: 2000 },
          ],
        },
      }),
    ]),
  );
  const baseline = game(),
    before = cloneDeep(state);
  const forecast = generateNewTimeline(
    state,
    now(state).cash,
    now(state).customers,
    TICKS_PER_MONTH * 3 + 1,
  );
  const plain = generateNewTimeline(
    baseline,
    now(baseline).cash,
    now(baseline).customers,
    TICKS_PER_MONTH * 3 + 1,
  );
  const index = forecast.findIndex((tick) => tick.minute === MINUTES_PER_MONTH);
  expect(forecast[index].revenueGrants).toBe(10000);
  expect(forecast[index].revenue - plain[index].revenue).toBe(10000);
  expect(forecast[index].expensesOM - plain[index].expensesOM).toBeCloseTo(
    2000,
    6,
  );
  expect(forecast[index].cash - plain[index].cash).toBeCloseTo(8000, 5);
  expect(
    forecast.reduce((total, tick) => total + (tick.revenueGrants ?? 0), 0),
  ).toBe(10000);
  expect(state).toEqual(before);
  advance(state, 1);
  expect(now(state).revenueGrants).toBe(forecast[index].revenueGrants);
});

test("numeric expiry and recovery message are exact while untilEnd lasts through the final playable month", () => {
  const state = game(
    pack([
      event({
        id: "standing",
        durationMonths: "untilEnd",
        effects: { demandMultiplier: 1.1 },
      }),
      event({
        startMonth: 2,
        durationMonths: 1,
        endMessage: "The temporary change ends.",
        effects: { temperatureOffsetC: 5 },
      }),
    ]),
  );
  advance(state, 1);
  expect(resolveStoryAtDate(context(state)).effects).toMatchObject({
    demandMultiplier: 1.1,
    temperatureOffsetC: 5,
  });
  expect(occurrence(state).endsMinute).toBe(2 * MINUTES_PER_MONTH);
  advance(state, 2);
  expect(resolveStoryAtDate(context(state)).effects.temperatureOffsetC).toBe(0);
  expect(
    state.worldEvents.occurrences.filter(
      (item) => item.key === `${key("change")}:end`,
    ),
  ).toHaveLength(1);
  expect(
    state.worldEvents.occurrences.find(
      (item) => item.key === `${key("change")}:end`,
    )?.message,
  ).toBe("The temporary change ends.");
  advance(state, 5);
  expect(resolveStoryAtDate(context(state)).effects.demandMultiplier).toBe(1.1);
  expect(
    resolveStoryAtDate(context(state, 6)).effects.demandMultiplier,
  ).toBeUndefined();
});

test("forecast surprises remain hidden and forecasts leave activation receipts and targets untouched", () => {
  const hidden = game(
    pack([
      event({
        startMonth: 2,
        durationMonths: 1,
        visibility: "surprise",
        effects: {
          outputMultipliersByFuel: { "Natural Gas": 0 },
          transactions: [{ kind: "grant", amountDollars: 10000 }],
        },
      }),
    ]),
  );
  const baseline = game();
  const before = cloneDeep(hidden);
  const forecast = generateNewTimeline(
    hidden,
    now(hidden).cash,
    now(hidden).customers,
    TICKS_PER_MONTH * 3,
  );
  const plain = generateNewTimeline(
    baseline,
    now(baseline).cash,
    now(baseline).customers,
    TICKS_PER_MONTH * 3,
  );
  expect(forecast.map((tick) => tick.supplyW)).toEqual(
    plain.map((tick) => tick.supplyW),
  );
  expect(forecast.every((tick) => tick.revenueGrants === 0)).toBe(true);
  expect(upcomingStoryPhases(context(hidden))).toEqual([]);
  expect(hidden).toEqual(before);
  advance(hidden, 1);
  expect(occurrence(hidden).forecastable).toBe(false);
  expect(now(hidden).revenueGrants).toBe(10000);
  expect(hidden.timeline.every((tick) => tick.supplyW === 0)).toBe(true);
});

test("a paused original remains targeted, but selling it and reusing its ID never transfers catalog identity", () => {
  let state = game(
    pack([
      event({
        durationMonths: "untilEnd",
        effects: {
          outputMultipliersBySelector: [
            {
              target: {
                selector: "startingAsset",
                assetId: "scenario-999-natural-gas-peaker",
              },
              outputMultiplier: 0,
            },
          ],
        },
      }),
    ]),
  );
  const original = state.facilities[0];
  expect(occurrence(state).attributes.selectedFacilityIds).toEqual([
    original.id,
  ]);
  state = cloneDeep(reducer(state, togglePauseFacility(original.id)));
  expect(
    resolveStoryAtDate(context(state)).effects.facilityOutputMultipliersById,
  ).toEqual({ [original.id]: 0 });
  state = cloneDeep(reducer(state, sellFacility(original.id)));
  const quote = GENERATORS(state, 500e6, [20], [500]).find(
    (item) => item.name === "Natural Gas Peaker",
  )!;
  const forged = {
    ...quote,
    yearsToBuild: 0,
    startingAssetId: original.startingAssetId,
    assetId: original.startingAssetId,
  };
  state = cloneDeep(
    reducer(state, buildFacility({ facility: forged, financed: false })),
  );
  expect(state.facilities).toHaveLength(1);
  expect(state.facilities[0].id).toBe(original.id);
  expect(state.facilities[0].startingAssetId).toBeUndefined();
  expect(
    resolveStoryAtDate(context(state)).effects.facilityOutputMultipliersById,
  ).toBeUndefined();
  expect(occurrence(state).attributes.selectedFacilityNames).toEqual([
    original.name,
  ]);
  expect(state.timeline.some((tick) => tick.supplyW > 0)).toBe(true);
  expect(
    resolveStoryAtDate(context(restore(state))).effects
      .facilityOutputMultipliersById,
  ).toBeUndefined();
});

test("empty eligible selection records a visible warning once without targeting another fuel", () => {
  const state = game(
    pack([
      event({
        effects: {
          outputMultipliersBySelector: [
            {
              target: { selector: "oldestOperating", fuel: "Coal", count: 1 },
              outputMultiplier: 0,
            },
          ],
        },
      }),
    ]),
  );
  expect(occurrence(state).attributes.noMatch).toBe(true);
  expect(occurrence(state).attributes.selectedFacilityIds).toEqual([]);
  expect(occurrence(state).message).toContain("No eligible owned facility");
  expect(state.timeline.some((tick) => tick.supplyW > 0)).toBe(true);
  const resumed = restore(state);
  tickState(resumed);
  expect(
    resumed.worldEvents.occurrences.filter(
      (item) => item.key === key("change"),
    ),
  ).toHaveLength(1);
});

test("a same-minute ID-reusing replacement is detached even when the original was commissioned at opening", () => {
  const input = pack([
    event({
      durationMonths: "untilEnd",
      effects: {
        outputMultipliersBySelector: [
          { target: { selector: "largestOperating" }, outputMultiplier: 0 },
        ],
      },
    }),
  ]);
  input.baseScenarioId = 106;
  let state = game(input);
  const original = state.facilities.find(
    (facility) =>
      facility.startingAssetId === "scenario-106-natural-gas-peaker",
  )!;
  expect(original.minuteCreated).toBe(0);
  expect(occurrence(state).attributes.selectedFacilityIds).toEqual([
    original.id,
  ]);
  const highest = Math.max(...state.facilities.map((facility) => facility.id));
  state = cloneDeep(reducer(state, sellFacility(highest)));
  state = cloneDeep(reducer(state, sellFacility(original.id)));
  const quote = GENERATORS(state, 100e6, [20], [500]).find(
    (facility) => facility.name === "Natural Gas Peaker",
  )!;
  state = cloneDeep(
    reducer(
      state,
      buildFacility({
        facility: {
          ...quote,
          yearsToBuild: 0,
          startingAssetId: original.startingAssetId,
        } as GeneratorShoppingType,
        financed: false,
      }),
    ),
  );
  expect(state.facilities[0].id).toBe(original.id);
  expect(state.facilities[0].minuteCreated).toBe(original.minuteCreated);
  expect(state.facilities[0].startingAssetId).toBeUndefined();
  expect(
    resolveStoryAtDate(context(state)).effects.facilityOutputMultipliersById,
  ).toBeUndefined();
  expect(state.timeline.some((tick) => tick.supplyW > 0)).toBe(true);
});

test("compiled imported arcs activate, forecast and resume with installed catalog lookup unavailable", () => {
  const input = pack();
  input.baseScenarioId = 101;
  input.officialArcs = [{ scenarioId: 101, includeChoices: false }];
  input.scenario!.durationMonths = 144;
  const scenario = modScenario(input);
  const lookup = jest
    .spyOn(officialCatalog, "officialScenarioRuleDefinition")
    .mockImplementation(() => {
      throw new Error("Detached rules invoked the installed catalog");
    });
  try {
    const state = createGame({
      scenarioId: 999,
      scenario,
      seed: input.seed,
      weatherHazardsEnabled: false,
    });
    const bridge = scenario.mod!.rules.arcEvents!.find(
      (item) => item.source?.phaseId === "bridge-contracts",
    )!;
    expect(
      state.worldEvents.occurrences.some((item) => item.key === bridge.key),
    ).toBe(true);
    const snapshot = cloneDeep(state);
    expect(
      generateNewTimeline(
        state,
        now(state).cash,
        now(state).customers,
        TICKS_PER_MONTH * 2,
      ).length,
    ).toBe(TICKS_PER_MONTH * 2);
    expect(state).toEqual(snapshot);
    const resumed = restore(state);
    tickState(state);
    tickState(resumed);
    expect(recorded(resumed)).toEqual(recorded(state));
  } finally {
    lookup.mockRestore();
  }
});

test("monthly company expenses expire while an industrial load begins later and remains permanent", () => {
  const expenses = event({
    startMonth: 2,
    durationMonths: 1,
    effects: { operatingExpenseDollarsPerMonth: 9600 },
    loads: [
      {
        id: "mine",
        startMonth: 3,
        demandType: "Mining",
        loadFactor: 1,
        peakMW: 10,
      },
    ],
  });
  const state = game(pack([expenses])),
    baseline = game();
  advance(state, 1);
  advance(baseline, 1);
  expect(now(state).expensesOM - now(baseline).expensesOM).toBeCloseTo(100, 6);
  expect(now(state).demandByType.Mining).toBe(0);
  advance(state, 2);
  advance(baseline, 2);
  expect(
    state.monthlyHistory[0].expensesOM - baseline.monthlyHistory[0].expensesOM,
  ).toBeCloseTo(9600, 5);
  expect(now(state).demandByType.Mining).toBe(10e6);
  expect(
    resolveStoryAtDate(context(state)).effects.operatingExpensePerMonth,
  ).toBeUndefined();
  advance(state, 3);
  expect(now(state).demandByType.Mining).toBe(10e6);
  expect(restore(state).loadAdditions).toEqual(state.loadAdditions);
});

test("timed build and operating quotes compose with static facility modifiers and expire cleanly", () => {
  const input = pack([
    event({
      effects: {
        constructionCostMultipliersByFuel: { "Natural Gas": 0.5 },
        operatingCostMultipliersByFuel: { "Natural Gas": 1.5 },
      },
    }),
  ]);
  input.facilities = {
    "Natural Gas Peaker": { buildCost: 1.2, annualOperatingCost: 1.25 },
  };
  const plain = { ...input, events: [] };
  const state = game(input),
    baseline = game(plain);
  const quote = (owner: GameType): GeneratorShoppingType =>
    GENERATORS(owner, 100e6, [20], [500]).find(
      (item) => item.name === "Natural Gas Peaker",
    )!;
  expect(quote(state).buildCost).toBeCloseTo(
    quote(baseline).buildCost * 0.5,
    5,
  );
  // The purchase snapshot retains base O&M; the runtime applies the timed cost once while active.
  expect(quote(state).annualOperatingCost).toBe(
    quote(baseline).annualOperatingCost,
  );
  expect(now(state).expensesOM).toBeCloseTo(now(baseline).expensesOM * 1.5, 5);
  advance(state, 1);
  advance(baseline, 1);
  expect(quote(state).buildCost).toBe(quote(baseline).buildCost);
  expect(quote(state).annualOperatingCost).toBe(
    quote(baseline).annualOperatingCost,
  );
});

test("an opening construction discount changes new quotes while inherited assets and a committed financed build retain their prices", () => {
  const input = pack([
    event({ effects: { constructionCostMultipliersByFuel: { Coal: 0.5 } } }),
  ]);
  input.baseScenarioId = 100;
  input.facilities = { Coal: { buildCost: 1.2 } };
  let state = game(input);
  const baseline = game({ ...input, events: [] });
  const original = state.facilities.find(
    (facility) => facility.fuel === "Coal",
  )!;
  expect(original.buildCost).toBe(
    baseline.facilities.find((facility) => facility.fuel === "Coal")!.buildCost,
  );
  const quote = (owner: GameType) =>
    GENERATORS(owner, 100e6, [20], [500]).find(
      (facility) => facility.name === "Coal",
    )!;
  const discounted = quote(state);
  expect(discounted.buildCost).toBeCloseTo(quote(baseline).buildCost * 0.5, 5);
  const oldIds = new Set(state.facilities.map((facility) => facility.id));
  state = cloneDeep(
    reducer(state, buildFacility({ facility: discounted, financed: true })),
  );
  const built = state.facilities.find((facility) => !oldIds.has(facility.id))!;
  expect(built.buildCost).toBe(discounted.buildCost);
  expect(built.loanAmountTotal).toBeGreaterThan(0);
  const committed = {
    buildCost: built.buildCost,
    loanAmountTotal: built.loanAmountTotal,
    loanMonthlyPayment: built.loanMonthlyPayment,
  };
  advance(state, 1);
  expect(
    state.facilities.find((facility) => facility.id === built.id),
  ).toMatchObject(committed);
  expect(
    state.facilities.find((facility) => facility.id === original.id)!.buildCost,
  ).toBe(original.buildCost);
});

test("every seeded range month can activate through the real reducer without a second placement draw", () => {
  const inputs = new Map<number, ModPackage>();
  for (let seed = 0; seed < 50; seed++) {
    const input = {
      ...pack([
        event({
          startMonth: { from: 2, to: 4 },
          effects: { outputMultipliersByFuel: { "Natural Gas": 0 } },
        }),
      ]),
      seed,
    };
    const resolved = modScenario(input);
    inputs.set(resolved.mod!.rules.events[0].startMonth, input);
  }
  expect([...inputs.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  for (const [month, input] of inputs) {
    const state = game(input);
    advance(state, month);
    expect(occurrence(state).startsMinute).toBe(month * MINUTES_PER_MONTH);
    expect(now(state).supplyW).toBe(0);
    const resumed = restore(state);
    expect(occurrence(resumed).startsMinute).toBe(
      occurrence(state).startsMinute,
    );
  }
});

test.each(DIFFICULTY_IDS)(
  "first-month magnitudes and durations use the selected %s table",
  (difficulty) => {
    const magnitudes = { Intern: 0, Employee: 1, Manager: 2, VP: 3, CEO: 4 };
    const durations = { Intern: 1, Employee: 2, Manager: 3, VP: 4, CEO: 5 };
    const state = game(
      pack([
        event({
          durationMonths: { byDifficulty: durations },
          effects: { temperatureOffsetC: { byDifficulty: magnitudes } },
        }),
      ]),
      difficulty,
    );
    expect(resolveStoryAtDate(context(state)).effects.temperatureOffsetC).toBe(
      magnitudes[difficulty],
    );
    expect(occurrence(state).endsMinute).toBe(
      durations[difficulty] * MINUTES_PER_MONTH,
    );
  },
);

test("headless simulation and manual ticks retain identical monthly accounting and occurrences", () => {
  const input = pack([
    event({
      startMonth: 2,
      durationMonths: 2,
      effects: {
        transactions: [{ kind: "grant", amountDollars: 10000 }],
        operatingExpenseDollarsPerMonth: 9600,
      },
    }),
  ]);
  const scenario = modScenario(input);
  const live = createGame({
    scenarioId: 999,
    scenario,
    seed: input.seed,
    weatherHazardsEnabled: false,
  });
  advance(live, 3);
  const headless = runSimulation({
    scenarioId: 999,
    scenario,
    seed: input.seed,
    months: 3,
    weatherHazardsEnabled: false,
  });
  expect(headless.violations).toEqual([]);
  expect(headless.months).toEqual([...live.monthlyHistory].reverse());
  expect(headless.storyOccurrences).toEqual(live.worldEvents.occurrences);
});
