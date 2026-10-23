import { inheritedModObjectives } from "../mods/ModScenario";
import { getScenario } from "../data/Scenarios";
import cloneDeep from "lodash.clonedeep";
import type { RuleObjective } from "../data/ScenarioRules";
import { GENERATORS } from "../data/Facilities";
import {
  gameObjectiveResults,
  objectiveContextForGame,
  scenarioObjectiveDefinitions,
  runFailure,
} from "../helpers/ObjectiveRules";
import {
  createObjectiveProgress,
  recordObjectiveMonth,
  validObjectiveProgress,
} from "../helpers/ScenarioObjectives";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { parseSave } from "../SaveGame";
import { modScenario, modValidationDiagnostics } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { modPackage } from "../testing/ModFixtures";
import { createGame, runSimulation } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";
import type { GameType } from "../Types";
import reducer, {
  buildFacility,
  delta,
  generateNewTimeline,
  sellFacility,
  tickState,
  togglePauseFacility,
} from "./Game";
import { roundTrip } from "../testing/SaveForgery";

const pack = (items: RuleObjective[] = []): ModPackage =>
  modPackage({
    id: "objective-boundaries",
    title: "Objective boundaries",
    description: "Observe actual completed months.",
    officialArcs: [],
    scenario: {
      durationMonths: 6,
      startingYear: 2020,
      cash: 1e9,
      startingCustomers: 10000,
      dollarsPerkWh: 0.2,
    },
    objectives: items,
  });
const window = { fromMonth: 1, throughMonth: 6 };
const goals: RuleObjective[] = [
  {
    id: "reliable",
    label: "Serve demand",
    metric: "monthlyReliability",
    ...window,
    minDemandServedShare: 1,
  },
  {
    id: "retained",
    label: "Retain customers",
    metric: "customerRetention",
    deadlineMonth: 6,
    minRetainedShare: 0.9,
  },
  {
    id: "budget",
    label: "Stay in budget",
    metric: "emissionsBudget",
    ...window,
    budgetTonnesCO2e: 1e9,
  },
  {
    id: "intensity",
    label: "Limit emissions intensity",
    metric: "emissionsPerDeliveredMWh",
    ...window,
    maxKgCO2ePerMWh: 1e6,
  },
  {
    id: "fuel",
    label: "Deliver local gas power",
    metric: "localFuelShare",
    ...window,
    fuels: ["Natural Gas"],
    minShare: 1,
  },
  {
    id: "retired",
    label: "Retire coal",
    metric: "fuelRetirement",
    deadlineMonth: 3,
    fuel: "Coal",
  },
  {
    id: "bills",
    label: "Limit customer bills",
    metric: "monthlyBilledRate",
    ...window,
    maxDollarsPerKWh: 1,
  },
  {
    id: "debt",
    label: "Limit closing principal",
    metric: "monthEndDebt",
    ...window,
    maxDebtDollars: 0,
  },
];
const game = (input = pack(goals)): GameType =>
  createGame({
    scenarioId: 999,
    scenario: modScenario(input, undefined, "Employee"),
    difficulty: "Employee",
    seed: input.seed,
  });
const restore = (state: GameType) => {
  const parsed = parseSave(roundTrip(state));
  expect(parsed).not.toBeNull();
  return cloneDeep(parsed!.game);
};
const now = (state: GameType) =>
  getTimeFromTimeline(state.date.minute, state.timeline)!;

test("all eight objectives observe real completed months and survive save/resume with trimmed presentation history", () => {
  const full = game();
  const resumed = restore(full);
  expect(
    gameObjectiveResults(full).every((result) => result.status === "pending"),
  ).toBe(true);
  for (let month = 1; month <= 6; month++) {
    runMonths(full, 1);
    runMonths(resumed, 1);
    expect(gameObjectiveResults(resumed)).toEqual(gameObjectiveResults(full));
    expect(
      runFailure(
        resumed,
        resumed.customScenario!,
        resumed.monthlyHistory,
        now(resumed),
        false,
      ),
    ).toBeUndefined();
    // Keep enough ordinary history for the separate three-month game-rule blackout check,
    // while all objective windows remain measured from their independent compact facts.
    resumed.monthlyHistory = resumed.monthlyHistory.slice(0, 3);
    Object.assign(resumed, restore(resumed));
  }
  expect(resumed.date.monthsElapsed).toBe(6);
  expect(gameObjectiveResults(resumed).map((result) => result.status)).toEqual(
    goals.map(() => "completed"),
  );
  expect(resumed.objectiveProgress!.retentionBaseline).toBe(10000);
  expect(resumed.objectiveProgress).toEqual(full.objectiveProgress);
});

test("a failed optional objective stays visible without ending the real or headless run", () => {
  const optional: RuleObjective = {
    id: "stretch",
    label: "Free electricity",
    metric: "monthlyBilledRate",
    ...window,
    maxDollarsPerKWh: 0,
    required: false,
  };
  const input = pack([goals[0], optional]);
  const state = game(input);
  runMonths(state, 1);
  expect(
    gameObjectiveResults(state).find((result) => result.id === "stretch"),
  ).toMatchObject({ required: false, status: "failed" });
  expect(
    runFailure(
      state,
      state.customScenario!,
      state.monthlyHistory,
      now(state),
      false,
    ),
  ).toBeUndefined();
  const result = runSimulation({
    scenarioId: 999,
    scenario: modScenario(input, undefined, "Employee"),
    difficulty: "Employee",
    seed: input.seed,
    months: 6,
  });
  expect(result.outcome).toBe("completed");
  expect(
    result.objectiveResults.find((result) => result.id === "stretch")?.status,
  ).toBe("failed");
  expect(result.violations).toEqual([]);
});

test("a required billed-rate miss terminates at its first irrevocable completed month", () => {
  const input = pack([
    {
      id: "bills",
      label: "Free electricity",
      metric: "monthlyBilledRate",
      ...window,
      maxDollarsPerKWh: 0,
    },
  ]);
  const result = runSimulation({
    scenarioId: 999,
    scenario: modScenario(input, undefined, "Employee"),
    difficulty: "Employee",
    seed: input.seed,
    months: 6,
  });
  expect(result.firedAtMonth).toBe(1);
  expect(result.objectiveResults[0]).toMatchObject({
    status: "failed",
    observedMonths: 1,
    requiredMonths: 6,
  });
  expect(result.violations).toEqual([]);
});

test("none succeeds at the final month while ordinary insolvency still fails", () => {
  const input = { ...pack(), objectives: [] };
  const result = runSimulation({
    scenarioId: 999,
    scenario: modScenario(input, undefined, "Employee"),
    difficulty: "Employee",
    seed: input.seed,
    months: 6,
  });
  expect(result.outcome).toBe("completed");
  expect(result.objectiveResults).toEqual([]);
  const state = game(input);
  runMonths(state, 1);
  expect(
    runFailure(
      state,
      state.customScenario!,
      state.monthlyHistory,
      { ...now(state), cash: -1 },
      false,
    ),
  ).toMatchObject({ outcome: "bankrupt" });
});

test.each(["operating", "paused", "unfinished"] as const)(
  "retirement counts %s assets at the deadline",
  (condition) => {
    let state = game(
      pack([
        {
          id: "retire",
          label: "Retire gas",
          metric: "fuelRetirement",
          fuel: "Natural Gas",
          deadlineMonth: 1,
        },
      ]),
    );
    const gas = state.facilities.find(
      (facility) => facility.fuel === "Natural Gas",
    )!;
    if (condition === "paused")
      state = cloneDeep(reducer(state, togglePauseFacility(gas.id)));
    if (condition === "unfinished") {
      const shopping = GENERATORS(state, 20e6, [], []).find(
        (facility) => facility.available && facility.fuel === "Natural Gas",
      )!;
      state = cloneDeep(reducer(state, sellFacility(gas.id)));
      state = cloneDeep(
        reducer(state, buildFacility({ facility: shopping, financed: false })),
      );
    }
    expect(
      state.facilities.some(
        (facility) =>
          facility.fuel === "Natural Gas" && facility.yearsToBuildLeft > 0,
      ),
    ).toBe(condition === "unfinished");
    runMonths(state, 1);
    expect(gameObjectiveResults(state)[0]).toMatchObject({
      status: "failed",
      observed: 1,
    });
    expect(restore(state).objectiveProgress).toEqual(state.objectiveProgress);
  },
);

test("a fuel bought after its retirement deadline breaches the continuing obligation at the next close", () => {
  let state = game(
    pack([
      {
        id: "retire",
        label: "Retire gas",
        metric: "fuelRetirement",
        fuel: "Natural Gas",
        deadlineMonth: 1,
      },
    ]),
  );
  const gas = state.facilities.find(
    (facility) => facility.fuel === "Natural Gas",
  )!;
  const shopping = GENERATORS(state, 20e6, [], []).find(
    (facility) => facility.available && facility.fuel === "Natural Gas",
  )!;
  state = cloneDeep(reducer(state, sellFacility(gas.id)));
  runMonths(state, 1);
  expect(gameObjectiveResults(state)[0]).toMatchObject({
    status: "inProgress",
    observed: 0,
  });
  state = cloneDeep(
    reducer(state, buildFacility({ facility: shopping, financed: false })),
  );
  runMonths(state, 1);
  expect(gameObjectiveResults(state)[0]).toMatchObject({
    status: "failed",
    observed: 1,
  });
});

test("forecasts do not record or complete objectives", () => {
  const state = game();
  const before = cloneDeep(state.objectiveProgress);
  const results = gameObjectiveResults(state);
  generateNewTimeline(state, now(state).cash, now(state).customers, 1152);
  expect(state.objectiveProgress).toEqual(before);
  expect(gameObjectiveResults(state)).toEqual(results);
  tickState(state);
  expect(state.objectiveProgress).toEqual(before);
});

test("save validation rejects missing, edited, mismatched and contradictory objective evidence atomically", () => {
  const state = game();
  runMonths(state, 1);
  const serialized = () => roundTrip(state);
  const edits = [
    (value: ReturnType<typeof serialized>) => {
      delete value.game.objectiveProgress;
    },
    (value: ReturnType<typeof serialized>) => {
      value.game.objectiveProgress.retentionBaseline += 1;
    },
    (value: ReturnType<typeof serialized>) => {
      value.game.objectiveProgress.completedMonths += 1;
    },
    (value: ReturnType<typeof serialized>) => {
      value.game.objectiveProgress.entries[0].observations[0][1] += 1;
    },
    (value: ReturnType<typeof serialized>) => {
      value.game.monthlyHistory[0].revenue += 1000;
    },
    (value: ReturnType<typeof serialized>) => {
      value.game.monthlyHistory.push(value.game.monthlyHistory[0]);
    },
  ];
  for (const edit of edits) {
    const raw = serialized();
    edit(raw);
    const before = cloneDeep(raw);
    expect(parseSave(raw)).toBeNull();
    expect(raw).toEqual(before);
  }
  expect(parseSave(serialized())).not.toBeNull();
});

test("a self-consistent forged progress chain cannot contradict retained accounting facts", () => {
  const state = game(pack([goals[6]]));
  runMonths(state, 1);
  const scenario = state.customScenario!,
    objectives = scenarioObjectiveDefinitions(scenario),
    context = objectiveContextForGame(state, scenario);
  const fakeRow = {
    ...state.monthlyHistory[0],
    revenue: 0,
    revenueGrants: 0,
    revenueExports: 0,
  };
  state.objectiveProgress = recordObjectiveMonth(
    createObjectiveProgress(objectives, context, 10000),
    objectives,
    { month: 0, history: fakeRow },
    context,
  );
  expect(
    validObjectiveProgress(state.objectiveProgress, objectives, context),
  ).toBe(true);
  expect(parseSave(roundTrip(state))).toBeNull();
});

test("absent-fuel retirement is a warning that never blocks launching", () => {
  const input = pack([goals[5]]);
  expect(modValidationDiagnostics(input)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "trivial-retirement",
        severity: "warning",
      }),
    ]),
  );
  expect(() => modScenario(input)).not.toThrow();
});

test("generic UI deltas cannot replace authoritative objective progress", () => {
  const state = game();
  runMonths(state, 1);
  const before = cloneDeep(state.objectiveProgress);
  const forged = cloneDeep(before!);
  forged.retentionBaseline = 1;
  const after = reducer(state, delta({ objectiveProgress: forged }));
  expect(after.objectiveProgress).toEqual(before);
});

test("save validation rejects a consistent progress chain omitting a known retained month", () => {
  const state = game(pack([goals[6]]));
  runMonths(state, 2);
  const scenario = state.customScenario!,
    objectives = scenarioObjectiveDefinitions(scenario),
    context = objectiveContextForGame(state, scenario);
  // The chain is structurally valid and its clock is current, but it omits month one,
  // whose actual accounting record remains present in this save.
  state.objectiveProgress = recordObjectiveMonth(
    createObjectiveProgress(objectives, context, 10000),
    objectives,
    { month: 1, history: state.monthlyHistory[0] },
    context,
  );
  expect(
    validObjectiveProgress(state.objectiveProgress, objectives, context),
  ).toBe(true);
  expect(parseSave(roundTrip(state))).toBeNull();
});

test("omitted and replaced goals use common results without retaining replaced official requirements", () => {
  const input = pack();
  input.baseScenarioId = 100;
  input.scenario = { ...input.scenario, durationMonths: 144 };
  const observe = (objectives: ModPackage["objectives"]) => {
    const runPack = { ...input };
    if (objectives === undefined) delete runPack.objectives;
    else runPack.objectives = objectives;
    const state = game(runPack);
    runMonths(state, 1);
    return { state, results: gameObjectiveResults(state) };
  };
  const inherited = observe(undefined);
  expect(inherited.results).toEqual([
    expect.objectContaining({
      id: "base-100-retention",
      status: "inProgress",
      required: true,
    }),
  ]);
  const bills: RuleObjective = {
    id: "bill-limit",
    label: "Free bills",
    metric: "monthlyBilledRate",
    fromMonth: 1,
    throughMonth: 1,
    maxDollarsPerKWh: 0,
  };
  const added = observe([...inheritedModObjectives(getScenario(100)!), bills]);
  expect(added.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "base-100-retention",
        status: "inProgress",
      }),
      expect.objectContaining({ id: "bill-limit", status: "failed" }),
    ]),
  );
  expect(
    runFailure(
      added.state,
      added.state.customScenario!,
      added.state.monthlyHistory,
      now(added.state),
      false,
    )?.title,
  ).toBe("Mission objective missed");
  const replaced = observe([{ ...bills, maxDollarsPerKWh: 1 }]);
  expect(replaced.results).toEqual([
    expect.objectContaining({ id: "bill-limit", status: "completed" }),
  ]);
  expect(replaced.state.monthlyHistory).toEqual(inherited.state.monthlyHistory);
});
