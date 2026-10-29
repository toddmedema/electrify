import cloneDeep from "lodash.clonedeep";
import { DIFFICULTY_IDS, TICKS_PER_MONTH } from "../Constants";
import { SCENARIOS } from "../data/Scenarios";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { inEraMoney } from "../data/FuelPrices";
import { resolveStoryAtDate } from "../data/WorldEvents";
import * as officialCatalog from "../data/OfficialScenarioRules";
import type { CompiledRuleChoice } from "../data/ScenarioRules";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "../helpers/DateTime";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { GENERATORS } from "../data/Facilities";
import {
  bulkWinterizationQuote,
  resilienceBuildOptions,
  withResilienceOptions,
} from "../helpers/Hazards";
import { buildStorySnapshot, storyOutputMultiplier } from "../helpers/Story";
import { runFailure } from "../helpers/ObjectiveRules";
import { modScenario } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { parseSave } from "../SaveGame";
import { createGame, runSimulation } from "../testing/Simulator";
import type { DifficultyType, GameType } from "../Types";
import reducer, { delta, generateNewTimeline, tickState } from "./Game";
import { chooseScenarioResponse } from "./GameActions";
import { roundTrip } from "../testing/SaveForgery";

// Independent pre-conversion values: the existing public choices, not the new compiler's output.
const catalog = [
  {
    lane: "current",
    arc: 106,
    id: "connection",
    dueMonth: 48,
    options: [
      { id: "fast-track", cost: 0, grant: 15000000 },
      { id: "phased", cost: 0, grant: 0 },
    ],
  },
  {
    lane: "current",
    arc: 107,
    id: "winterization",
    dueMonth: 36,
    options: [
      { id: "winterize", cost: 90000000, grant: 0 },
      { id: "standard", cost: 0, grant: 0 },
    ],
  },
] as const;
const source = (id: number) =>
  SCENARIOS.find((scenario) => scenario.id === id)!;
const pack = (
  arc: number,
  includeChoices = true,
  override: Partial<ModPackage> = {},
): ModPackage => ({
  schemaVersion: 1,
  gameApi: 1,
  id: "adapted-grid",
  title: "Adapted grid",
  creator: "Fixture",
  version: "1",
  description: "A grid with an adapted official decision.",
  seed: 12345,
  baseScenarioId: arc,
  officialArcs: [{ scenarioId: arc, includeChoices }],
  objectives: [],
  scenario: { cash: 1e12 },
  ...override,
});
const start = (input: ModPackage, difficulty: DifficultyType = "Employee") =>
  createGame({
    scenarioId: 999,
    scenario: scenarioFor(input, difficulty),
    difficulty,
    seed: input.seed,
    weatherHazardsEnabled: false,
  });
const scenarioFor = (
  input: ModPackage,
  difficulty: DifficultyType = "Employee",
) => modScenario(input, undefined, difficulty);
const now = (state: GameType) =>
  getTimeFromTimeline(state.date.minute, state.timeline)!;
const definition = (state: GameType, arc: number): CompiledRuleChoice =>
  state.customScenario!.mod!.rules.arcChoices!.find(
    (choice) => choice.source?.scenarioId === arc,
  )!;
const key = (arc: number, id: string) =>
  `mod:adapted-grid:arc:${arc}:choice:${id}`;
const respond = (decisionId: string, optionId: string) =>
  chooseScenarioResponse({ decisionId, optionId });
function advance(state: GameType, month: number) {
  let previous = state.date.monthsElapsed;
  for (
    let tick = 0;
    state.date.monthsElapsed < month && tick < (month + 1) * TICKS_PER_MONTH;
    tick++
  ) {
    tickState(state);
    if (state.date.monthsElapsed !== previous) {
      expect(
        runFailure(
          state,
          state.customScenario!,
          state.monthlyHistory,
          now(state),
          false,
        ),
      ).toBeUndefined();
      previous = state.date.monthsElapsed;
    }
  }
  expect(state.date.monthsElapsed).toBe(month);
}
function restore(state: GameType): GameType {
  const saved = parseSave(roundTrip(state));
  expect(saved).not.toBeNull();
  return cloneDeep(saved!.game);
}
const context = (state: GameType, month: number) => ({
  rules: state.customScenario!.mod!.rules,
  seed: state.seed,
  scenarioId: 999,
  difficulty: state.difficulty,
  date: getDateFromMinute(month * MINUTES_PER_MONTH, state.startingYear),
  location: state.location,
  snapshot: buildStorySnapshot(
    state.monthlyHistory,
    state.facilities,
    month * MINUTES_PER_MONTH,
  ),
  occurrences: state.worldEvents.occurrences,
  monthlyHistory: state.monthlyHistory,
  completedMonths: state.date.monthsElapsed,
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("imported freeze offers permanent construction packages for every affected fuel", () => {
  const game = start(pack(107));
  const quotes = GENERATORS(game, 100e6, [], []);
  for (const fuel of ["Natural Gas", "Coal", "Uranium", "Wind"] as const) {
    const quote = quotes.find((item) => item.fuel === fuel)!;
    expect(
      resilienceBuildOptions(quote, game).some(
        (option) => option.upgrade === "coldWeatherPackage",
      ),
    ).toBe(true);
    expect(
      withResilienceOptions(quote, game, { coldWeatherPackage: true })
        .resilience?.coldWeatherPackage,
    ).toBe(true);
  }
});

test.each(
  catalog.flatMap((entry) =>
    DIFFICULTY_IDS.flatMap((difficulty) =>
      entry.options.map((option) => ({ ...entry, difficulty, option })),
    ),
  ),
)(
  "$lane arc $arc on $difficulty reaches and applies $option.id exactly once",
  ({ arc, id, dueMonth, difficulty, option }) => {
    const before = start(pack(arc), difficulty);
    expect(definition(before, arc).dueMonth).toBe(dueMonth);
    advance(before, dueMonth);
    expect(pendingScenarioChoice(before)?.id).toBe(key(arc, id));
    expect(before.date.minute).toBe(dueMonth * MINUTES_PER_MONTH);
    expect(before.speed).toBe("PAUSED");
    const pending = restore(before);
    expect(pendingScenarioChoice(pending)?.id).toBe(key(arc, id));
    const cost =
      arc === 107 && option.id === "winterize"
        ? bulkWinterizationQuote(before).cost
        : option.cost;
    const after = reducer(before, respond(key(arc, id), option.id));
    const resumedAnswer = reducer(pending, respond(key(arc, id), option.id));
    expect(now(after).cash - now(before).cash).toBe(option.grant - cost);
    expect(now(after).revenue - now(before).revenue).toBe(option.grant);
    expect(now(after).revenueGrants - now(before).revenueGrants).toBe(
      option.grant,
    );
    // Installation changes dispatch O&M too; assets own the exact retrofit payments.
    const payments = after.worldEvents.occurrences.filter(
      (event) =>
        event.attributes.retrofit === true &&
        event.startsMinute === before.date.minute,
    );
    const payment =
      arc === 107 && option.id === "winterize"
        ? payments.reduce(
            (sum, event) => sum + Number(event.attributes.cost),
            0,
          )
        : now(after).expensesOM - now(before).expensesOM;
    expect(payment).toBeCloseTo(cost, 6);
    expect(after.speed).toBe("PAUSED");
    expect(pendingScenarioChoice(after)).toBeUndefined();
    expect(
      after.worldEvents.occurrences.find((event) => event.key === key(arc, id)),
    ).toMatchObject({
      startsMinute: dueMonth * MINUTES_PER_MONTH,
      attributes: {
        choice: option.id,
        cost: arc === 107 ? 0 : cost,
        upfrontGrant: option.grant,
        ruleChoice: true,
      },
    });
    expect(resumedAnswer.loadAdditions).toEqual(after.loadAdditions);
    expect(now(resumedAnswer).cash).toBe(now(after).cash);
    expect(resumedAnswer.worldEvents.occurrences).toEqual(
      after.worldEvents.occurrences,
    );
    expect(reducer(after, respond(key(arc, id), option.id))).toBe(after);
    const afterSave = restore(after);
    expect(afterSave.worldEvents.occurrences).toEqual(
      after.worldEvents.occurrences,
    );
    expect(afterSave.loadAdditions).toEqual(after.loadAdditions);
    expect(
      now(reducer(after, delta({ dollarsPerkWh: after.dollarsPerkWh }))).cash,
    ).toBe(now(after).cash);
  },
);

test.each(catalog)(
  "$lane arc $arc with choices disabled records its free answer at the actual due boundary",
  ({ arc, id, dueMonth }) => {
    const input = pack(arc, false);
    const state = start(input);
    advance(state, dueMonth);
    expect(pendingScenarioChoice(state)).toBeUndefined();
    const answer = state.worldEvents.occurrences.find(
      (event) => event.key === key(arc, id),
    )!;
    expect(answer).toBeDefined();
    expect(answer.attributes.automatic).toBe(true);
    expect(answer.attributes.choice).toBe(
      arc === 106 ? "fast-track" : "standard",
    );
    expect(answer.message).toMatch(/^Resolved automatically:/);
    const saved = restore(state);
    tickState(saved);
    expect(
      saved.worldEvents.occurrences.filter(
        (event) => event.key === key(arc, id),
      ),
    ).toHaveLength(1);
  },
);

test("phasing replaces only the imported campus and retains source offsets after a grid/year change", () => {
  const input = pack(106, true, {
    scenario: { cash: 1e12, startingYear: 2040, startingCustomers: 33000 },
    events: [
      {
        id: "mining",
        title: "Mine connection",
        message: "The mine connects.",
        preview: "The mine will connect.",
        startMonth: 10,
        loads: [
          {
            id: "unrelated-mine",
            startMonth: 10,
            demandType: "Mining",
            peakMW: 20,
            loadFactor: 0.8,
          },
        ],
      },
    ],
  });
  const before = start(input);
  advance(before, 48);
  const original = before.loadAdditions.find(
    (load) => load.id === "custom-106-manassas-data-centers",
  )!;
  expect(original.peakW).toBe(200e6);
  expect(original.startsYear).toBe(2046);
  const unrelated = before.loadAdditions.find((load) =>
    load.id.endsWith(":unrelated-mine"),
  )!;
  const after = reducer(before, respond(key(106, "connection"), "phased"));
  expect(after.loadAdditions.find((load) => load.id === unrelated.id)).toEqual(
    unrelated,
  );
  expect(
    after.loadAdditions.find((load) => load.id === original.id),
  ).toBeUndefined();
  expect(
    after.loadAdditions
      .filter((load) => load.id.startsWith("custom-106-"))
      .map((load) => ({
        id: load.id,
        peakW: load.peakW,
        year: load.startsYear,
      })),
  ).toEqual([
    {
      id: "custom-106-manassas-data-centers-phase-one",
      peakW: 100e6,
      year: 2046,
    },
    {
      id: "custom-106-manassas-data-centers-phase-two",
      peakW: 100e6,
      year: 2048,
    },
  ]);
  expect(
    definition(after, 106).options.every(
      (option) => !/202[068]/.test(`${option.description} ${option.message}`),
    ),
  ).toBe(true);
  expect(restore(after).loadAdditions).toEqual(after.loadAdditions);
  const funded = reducer(before, respond(key(106, "connection"), "fast-track"));
  expect(now(funded).cash - now(before).cash).toBeCloseTo(
    inEraMoney(30000000, 2040, source(106).startingYear),
    2,
  );
  const demand = (state: GameType, month: number) => {
    const future = cloneDeep(state);
    future.date = getDateFromMinute(
      month * MINUTES_PER_MONTH,
      future.startingYear,
    );
    return generateNewTimeline(future, 1e12, now(before).customers)[0]
      .demandByType;
  };
  for (const [month, share] of [
    [72, 0.5],
    [96, 1],
  ]) {
    const originalDemand = demand(before, month),
      phasedDemand = demand(after, month);
    expect(
      phasedDemand["Data Centers"] / originalDemand["Data Centers"],
    ).toBeCloseTo(share, 8);
    expect(phasedDemand.Mining).toBe(originalDemand.Mining);
  }
});

test.each([
  {
    lane: "current",
    arc: 107,
    id: "winterization",
    option: "winterize",
    dueMonth: 36,
    onsetMonth: 49,
    customers: 157567,
  },
])(
  "$lane arc $arc relocates its full paid budget and keeps preparation ahead of the shock",
  ({ arc, id, option, dueMonth, onsetMonth, customers }) => {
    const before = start(
      pack(arc, true, {
        scenario: {
          cash: 1e12,
          startingYear: 2040,
          startingCustomers: customers,
        },
      }),
    );
    advance(before, dueMonth);
    expect(pendingScenarioChoice(before)?.id).toBe(key(arc, id));
    const expected = bulkWinterizationQuote(before).cost;
    expect(expected).toBeGreaterThan(82e6);
    const after = reducer(before, respond(key(arc, id), option));
    expect(now(before).cash - now(after).cash).toBe(expected);
    expect(
      after.worldEvents.occurrences.find((event) => event.key === key(arc, id))
        ?.attributes.retrofitCost,
    ).toBe(expected);
    const onset = after.customScenario!.mod!.rules.arcEvents!.find(
      (event) => event.protection,
    )!;
    expect(onset.startMonth).toBe(onsetMonth);
    const activated = cloneDeep(after);
    advance(activated, onsetMonth);
    expect(
      activated.worldEvents.occurrences.find((event) => event.key === onset.key)
        ?.attributes.ruleProtectionFactor,
    ).toBe(0);
    expect(restore(activated).date).toEqual(activated.date);
  },
);

test.each([{ arc: 107, lane: "current" }])(
  "$lane arc $arc preparation changes committed future effects without mutating either forecast source",
  ({ arc }) => {
    const descriptor = catalog.find((entry) => entry.arc === arc)!;
    const before = start(pack(arc));
    advance(before, descriptor.dueMonth);
    const protectedId = "winterize";
    const after = reducer(
      before,
      respond(key(arc, descriptor.id), protectedId),
    );
    const onset = after.customScenario!.mod!.rules.arcEvents!.find(
      (event) => event.protection,
    )!;
    const oldState = JSON.stringify(before),
      newState = JSON.stringify(after);
    const standard = resolveStoryAtDate(context(before, onset.startMonth));
    const protectedEvent = resolveStoryAtDate(context(after, onset.startMonth));
    expect(protectedEvent.effects.fuelPriceMultipliers).toEqual(
      standard.effects.fuelPriceMultipliers,
    );
    expect(protectedEvent.effects.temperatureOffsetC).toBe(
      standard.effects.temperatureOffsetC,
    );
    const visible = protectedEvent.occurrences.find(
      (event) => event.key === onset.key,
    )!;
    const visibleConditions = [
      `Natural Gas unprotected cold output: ${Math.round(visible.effects.winterizationOutputMultipliersByFuel!["Natural Gas"]! * 100)}% of normal`,
    ];
    visibleConditions.forEach((condition) =>
      expect(visible.message).toContain(condition),
    );
    const unchangedField = "demandMultiplier";
    expect(protectedEvent.effects[unchangedField]).toBe(
      standard.effects[unchangedField],
    );
    const affectedLosses = after.facilities.map((facility) => [
      1 -
        storyOutputMultiplier(
          before.facilities.find((item) => item.id === facility.id)!,
          standard.effects,
          onset.startMonth * MINUTES_PER_MONTH,
        ),
      1 -
        storyOutputMultiplier(
          facility,
          protectedEvent.effects,
          onset.startMonth * MINUTES_PER_MONTH,
        ),
    ]);
    expect(affectedLosses.length).toBeGreaterThan(1);
    affectedLosses.forEach(([originalLoss, preparedLoss]) =>
      expect(preparedLoss).toBeCloseTo(originalLoss / 2, 10),
    );
    expect(JSON.stringify(before)).toBe(oldState);
    expect(JSON.stringify(after)).toBe(newState);
    const forecast = (state: GameType) => {
      const future = cloneDeep(state);
      future.date = getDateFromMinute(
        onset.startMonth * MINUTES_PER_MONTH,
        state.startingYear,
      );
      return generateNewTimeline(future, 1e12, now(before).customers);
    };
    const baseline = forecast(before),
      committed = forecast(after);
    const improvedMetric = "supplyW";
    const unchangedMetric = "demandW";
    expect(committed.map((tick) => tick[unchangedMetric])).toEqual(
      baseline.map((tick) => tick[unchangedMetric]),
    );
    expect(
      committed.reduce((sum, tick) => sum + tick[improvedMetric], 0),
    ).toBeGreaterThan(
      baseline.reduce((sum, tick) => sum + tick[improvedMetric], 0),
    );
    expect(JSON.stringify(before)).toBe(oldState);
    expect(JSON.stringify(after)).toBe(newState);
    const activated = cloneDeep(after);
    advance(activated, onset.startMonth);
    const recorded = activated.worldEvents.occurrences.find(
      (event) => event.key === onset.key,
    )!;
    expect(recorded.attributes.ruleProtectionFactor).toBe(0);
    expect(restore(activated).worldEvents.occurrences).toEqual(
      activated.worldEvents.occurrences,
    );
  },
);

test.each(catalog)(
  "$lane arc $arc's explicit paid/consequential branch matches the headless reducer path",
  ({ arc, id, dueMonth, options }) => {
    const selected = options[0].id;
    const input = pack(arc);
    const liveStart = createGame({
      scenarioId: 999,
      scenario: scenarioFor(input),
      seed: input.seed,
      difficulty: "Employee",
    });
    advance(liveStart, dueMonth);
    const live = cloneDeep(reducer(liveStart, respond(key(arc, id), selected)));
    advance(live, dueMonth + 1);
    const result = runSimulation({
      scenarioId: 999,
      scenario: scenarioFor(input),
      seed: input.seed,
      difficulty: "Employee",
      months: dueMonth + 1,
      strategy: "none",
      scenarioResponses: { [key(arc, id)]: selected },
    });
    expect(result.violations).toEqual([]);
    expect(result.months).toEqual([...live.monthlyHistory].reverse());
    expect(result.storyOccurrences).toEqual(live.worldEvents.occurrences);
  },
);

test("a saved imported choice executes with catalog lookup and source price callbacks unavailable", () => {
  const scenario = modScenario(pack(107));
  const choiceCallbacks = SCENARIO_CHOICES.flatMap((choice) =>
    choice.options.map((option) => ({
      option,
      cost: option.cost,
      grant: option.upfrontGrant,
    })),
  );
  const unavailable = () => {
    throw new Error("The installed catalog callbacks are unavailable.");
  };
  const lookup = jest
    .spyOn(officialCatalog, "officialScenarioRuleDefinition")
    .mockImplementation(unavailable);
  try {
    choiceCallbacks.forEach(({ option }) => {
      option.cost = unavailable;
      option.upfrontGrant = unavailable;
    });
    const before = createGame({
      scenarioId: 999,
      scenario,
      seed: scenario.seed,
      difficulty: "Employee",
      weatherHazardsEnabled: false,
    });
    advance(before, 36);
    const after = reducer(
      restore(before),
      respond(key(107, "winterization"), "winterize"),
    );
    expect(
      after.worldEvents.occurrences.find(
        (event) => event.key === key(107, "winterization"),
      )?.attributes.choice,
    ).toBe("winterize");
    expect(restore(after).worldEvents.occurrences).toEqual(
      after.worldEvents.occurrences,
    );
  } finally {
    lookup.mockRestore();
    choiceCallbacks.forEach(({ option, cost, grant }) => {
      option.cost = cost;
      option.upfrontGrant = grant;
    });
  }
});
