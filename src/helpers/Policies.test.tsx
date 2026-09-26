import cloneDeep from "lodash.clonedeep";
import {
  advancePolicies,
  applyPolicyDemand,
  buildoutCompletionMonth,
  buildoutMonthsDone,
  efficiencyInEffect,
  emptyPolicies,
  policyBudget,
  policyTotalCost,
  programCustomers,
} from "./Policies";
import { POLICIES, residentialSolarCostPerW } from "../data/Policies";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import gameReducer, {
  generateNewTimeline,
  tickState,
  setSpeed,
} from "../reducers/Game";
import {
  schedulePolicy,
  cancelPolicy,
  chooseScenarioResponse,
  openPolicyDecision,
  closePolicyDecision,
} from "../reducers/GameActions";
import {
  getTimeFromTimeline,
  summarizeTimeline,
  deriveExpandedSummary,
} from "./DateTime";
import { previewPolicy } from "./PolicyPreview";
import { pendingScenarioChoice } from "./ScenarioChoices";
import { parseSave, serializeSave } from "../SaveGame";
import { decodeReplay, serializeReplay } from "../Replay";
import { TICK_MINUTES, TICKS_PER_MONTH, TICKS_PER_YEAR } from "../Constants";
import { GameType } from "../Types";

function month(game: GameType) {
  const target = game.date.monthsElapsed + 1;
  while (game.date.monthsElapsed < target) tickState(game);
}
const change = { id: "efficiency", tier: "On", month: 1 } as const;
const BUILDOUT = POLICIES.solar.buildoutMonths;

test("only the dialog that owns a pause restores its previous speed", () => {
  jest.useFakeTimers();
  let game = {
    ...createGame({ scenarioId: 106 }),
    speed: "SLOW" as const,
  } as GameType;
  game = gameReducer(game, openPolicyDecision("one"));
  expect(game.speed).toBe("PAUSED");
  expect(gameReducer(game, closePolicyDecision("other")).speed).toBe("PAUSED");
  expect(gameReducer(game, closePolicyDecision("one")).speed).toBe("SLOW");
  game = gameReducer(game, setSpeed("NORMAL"));
  expect(gameReducer(game, closePolicyDecision("one")).speed).toBe("NORMAL");
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("forecast resolution cannot multiply monthly spending or mutate live adoption", () => {
  const game = createGame({
    scenarioId: 106,
    initialPrograms: { efficiency: "On", solar: "On" },
  });
  const snapshot = cloneDeep(game.policies);
  const now = game.timeline[0];
  const fine = generateNewTimeline(
    game,
    now.cash,
    now.customers,
    TICKS_PER_MONTH * 3,
  );
  const hourly = generateNewTimeline(
    game,
    now.cash,
    now.customers,
    (TICKS_PER_MONTH * 3) / 4,
    60,
  );
  const expense = (timeline: typeof fine) =>
    timeline.reduce((sum, t) => sum + (t.expensesPolicy || 0), 0);
  expect(expense(hourly)).toBeCloseTo(expense(fine));
  expect(game.policies).toEqual(snapshot);
});

test("schedule, replace, cancel and reject stale/no-op edits without recording them", () => {
  let game = createGame({ scenarioId: 106, seed: 4 });
  game = gameReducer(game, schedulePolicy(change));
  expect(game.policies!.programs.efficiency.pending).toEqual({
    tier: "On",
    month: 1,
  });
  const log = game.replayLog!.length;
  expect(gameReducer(game, schedulePolicy(change)).replayLog).toHaveLength(log);
  expect(
    gameReducer(game, schedulePolicy({ ...change, month: 2 })).replayLog,
  ).toHaveLength(log);
  // Scheduling the current tier replaces the pending start with no change.
  game = gameReducer(game, schedulePolicy({ ...change, tier: "Off" }));
  expect(game.policies!.programs.efficiency.pending).toBeUndefined();
  game = gameReducer(game, schedulePolicy(change));
  expect(
    gameReducer(game, cancelPolicy({ ...change, tier: "Off" })).policies!
      .programs.efficiency.pending!.tier,
  ).toBe("On");
  game = gameReducer(game, cancelPolicy(change));
  expect(game.policies!.programs.efficiency.pending).toBeUndefined();
  expect(game.policies!.programs.efficiency.spending).toBe(0);
  const tutorial = createGame({ scenarioId: 0 });
  expect(
    gameReducer(tutorial, schedulePolicy(change)).policies,
  ).toBeUndefined();
  const ended = { ...game, date: { ...game.date, monthsElapsed: 191 } };
  expect(
    gameReducer(ended, schedulePolicy({ ...change, month: 192 })).replayLog,
  ).toEqual(game.replayLog);
  const replay = { ...game, replayPlayback: { actions: [], index: 0 } };
  expect(gameReducer(replay, schedulePolicy(change))).toEqual(replay);
});

test("adoption and actual spending are bounded, idempotent, and stop at saturation", () => {
  const game = createGame({ scenarioId: 106 });
  game.policies = emptyPolicies();
  const program = game.policies.programs.efficiency;
  program.tier = "On";
  program.adoption = 0.99;
  advancePolicies(game, 1);
  expect(program.adoption).toBe(1);
  expect(program.completedMonth).toBe(1);
  // The final partial month pays for 0.01 of the pool at the one-month rate.
  expect(program.spending).toBeCloseTo(
    policyBudget(game, "efficiency", "On", 1) * 0.01 * BUILDOUT,
  );
  expect(program.spent).toBe(program.spending);
  const saved = cloneDeep(game.policies);
  advancePolicies(game, 1);
  expect(game.policies).toEqual(saved);
  advancePolicies(game, 2);
  expect(program.spending).toBe(0);
  expect(program.completedMonth).toBe(1);
});

test("a build-out finishes after exactly its funded months, then costs nothing and cannot be rescheduled", () => {
  const game = createGame({ scenarioId: 106, seed: 4 });
  game.policies = emptyPolicies();
  const program = game.policies.programs.solar;
  expect(buildoutCompletionMonth("solar", 0, 1)).toBe(BUILDOUT);
  program.tier = "On";
  let total = 0;
  const completed: (number | undefined)[] = [];
  for (let m = 1; m <= BUILDOUT; m++) {
    advancePolicies(game, m);
    expect(buildoutMonthsDone("solar", program.adoption)).toBe(m);
    expect(program.spending).toBeCloseTo(policyBudget(game, "solar", "On", m));
    total += program.spending;
    completed.push(program.completedMonth);
  }
  expect(completed.slice(0, -1).every((m) => m === undefined)).toBe(true);
  expect(program.adoption).toBe(1);
  expect(program.completedMonth).toBe(BUILDOUT);
  expect(program.spent).toBeCloseTo(total);
  // Panel prices and inflation move the monthly price, so the sum lands between the totals
  // quoted at the start and at the end of the build-out.
  const quotes = [1, BUILDOUT].map((m) => policyTotalCost(game, "solar", m));
  expect(total).toBeGreaterThan(Math.min(...quotes) * 0.99);
  expect(total).toBeLessThan(Math.max(...quotes) * 1.01);
  advancePolicies(game, BUILDOUT + 1);
  expect(program.spending).toBe(0);
  expect(program.spent).toBeCloseTo(total);
  // Pausing a finished project has no effect, so the reducer refuses to record it.
  const fresh = createGame({ scenarioId: 106, seed: 4 });
  fresh.policies = emptyPolicies(fresh.date.monthsElapsed);
  Object.assign(fresh.policies.programs.solar, cloneDeep(program));
  const log = fresh.replayLog!.length;
  expect(
    gameReducer(fresh, schedulePolicy({ id: "solar", tier: "Off", month: 1 }))
      .replayLog,
  ).toHaveLength(log);
  expect(gameReducer(fresh, schedulePolicy(change)).replayLog).toHaveLength(
    log + 1,
  );
});

test("solar affects only eligible daylight load after efficiency; neutral demand is exact", () => {
  const game = createGame({ scenarioId: 106 });
  const original = cloneDeep(game.timeline[0]);
  const tick = cloneDeep(original);
  applyPolicyDemand(game, tick);
  expect(tick).toEqual(original);
  game.policies = emptyPolicies();
  game.policies.programs.solar.adoption = 1;
  tick.solarIrradianceWM2 = 0;
  applyPolicyDemand(game, tick);
  expect(tick.demandByType).toEqual(original.demandByType);
  Object.assign(game.policies.programs.efficiency, {
    adoption: 1,
    installs: [[0, 1]],
  });
  // A 25 C cell at full sun produces exactly nameplate before the rooftop derate.
  tick.solarIrradianceWM2 = 1000;
  tick.temperatureC = -5;
  const eligible =
    original.demandByType.Residential + original.demandByType.Commercial;
  applyPolicyDemand(game, tick, 0.5);
  // Half the load is heating and cooling: 10% off the rest, 35% off that half.
  expect(tick.efficiencySavedW).toBeCloseTo(eligible * 0.225);
  const panels =
    POLICIES.solar.cap * programCustomers(game) * POLICIES.solar.derate;
  expect(tick.rooftopSolarW).toBeCloseTo(Math.min(panels, eligible * 0.775));
  expect(
    tick.demandByType.Residential + tick.demandByType.Commercial,
  ).toBeCloseTo(eligible * 0.775 - tick.rooftopSolarW!);
  expect(tick.demandByType["Data centers"]).toBe(
    original.demandByType["Data centers"],
  );
  expect(tick.demandByType.Industrial).toBe(original.demandByType.Industrial);
});

test("preview is isolated, matches the real forecast and monthly costs reach cash/history", () => {
  let game = createGame({ scenarioId: 106, seed: 4 });
  const untouched = cloneDeep(game);
  const preview = previewPolicy(game, change, 1);
  expect(game).toEqual(untouched);
  game = cloneDeep(gameReducer(game, schedulePolicy(change)));
  const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
  const forecast = generateNewTimeline(
    game,
    now.cash,
    now.customers,
    TICKS_PER_MONTH * 2,
  );
  expect(forecast.slice(TICKS_PER_MONTH).map((t) => t.demandW)).toEqual(
    preview.changed,
  );
  month(game);
  expect(game.policies!.programs.efficiency.adoption).toBeCloseTo(1 / BUILDOUT);
  const expected = game.policies!.programs.efficiency.spending;
  expect(
    summarizeTimeline(game.timeline, game.startingYear).expensesPolicy,
  ).toBeCloseTo(expected);
  const first = cloneDeep(game.timeline);
  month(game);
  expect(game.monthlyHistory[0].expensesPolicy).toBeCloseTo(expected);
  expect(
    deriveExpandedSummary(game.monthlyHistory[0]).expenses,
  ).toBeGreaterThanOrEqual(expected);
  expect(
    first.every(
      (t) =>
        Object.values(t.demandByType).reduce((a, b) => a + b, 0) === t.demandW,
    ),
  ).toBe(true);
});

test("Off preserves installed upgrades through save/load and actions replay deterministically", () => {
  let game = cloneDeep(
    gameReducer(
      createGame({ scenarioId: 106, seed: 4 }),
      schedulePolicy(change),
    ),
  );
  month(game);
  game = cloneDeep(
    gameReducer(game, schedulePolicy({ ...change, tier: "Off", month: 2 })),
  );
  month(game);
  const stock = game.policies!.programs.efficiency.adoption;
  expect(stock).toBeCloseTo(1 / BUILDOUT);
  expect(game.policies!.programs.efficiency.spending).toBe(0);
  const restored = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  expect(restored.policies).toEqual(game.policies);
  const replay = createGameFromReplay(serializeReplay(game)!);
  month(replay);
  month(replay);
  expect(replay.policies).toEqual(game.policies);
  expect(replay.timeline.map((t) => t.cash)).toEqual(
    game.timeline.map((t) => t.cash),
  );
  month(restored);
  expect(restored.policies!.programs.efficiency.adoption).toBe(stock);
});

test("neutral saves round-trip; malformed stocks and policy actions are rejected", () => {
  const game = createGame({ scenarioId: 106 });
  const restored = parseSave(serializeSave(game))!;
  // A game that never touched a program has no policy record, and resuming it must not add one
  expect(restored.game.policies).toBeUndefined();
  const bad = cloneDeep(restored);
  bad.game.policies = emptyPolicies(restored.game.date.monthsElapsed);
  expect(parseSave(bad)).not.toBeNull();
  bad.game.policies!.programs.solar.adoption = 2;
  expect(parseSave(bad)).toBeNull();
  const replay = serializeReplay(game)!;
  expect(
    decodeReplay({
      ...replay,
      actions: [
        {
          type: "schedulePolicy",
          minute: 0,
          payload: { ...change, tier: "Huge" },
        },
      ],
    }),
  ).toBeNull();
});

test("a paused and resumed build-out completes through the reducer and its completion survives a save", () => {
  const solar = { id: "solar", tier: "On", month: 1 } as const;
  let game = cloneDeep(
    gameReducer(
      createGame({ scenarioId: 106, seed: 4 }),
      schedulePolicy(solar),
    ),
  );
  const program = () => game.policies!.programs.solar;
  const schedule = (tier: "On" | "Off") => {
    game = cloneDeep(
      gameReducer(
        game,
        schedulePolicy({
          ...solar,
          tier,
          month: game.date.monthsElapsed + 1,
        }),
      ),
    );
  };
  month(game);
  month(game);
  expect(buildoutMonthsDone("solar", program().adoption)).toBe(2);
  schedule("Off");
  month(game);
  month(game);
  expect(program().tier).toBe("Off");
  expect(buildoutMonthsDone("solar", program().adoption)).toBe(2);
  expect(program().spending).toBe(0);
  schedule("On");
  month(game);
  expect(program().tier).toBe("On");
  expect(buildoutMonthsDone("solar", program().adoption)).toBe(3);
  // Two paused months push the finish back by two months.
  expect(
    buildoutCompletionMonth(
      "solar",
      program().adoption,
      game.date.monthsElapsed + 1,
    ),
  ).toBe(BUILDOUT + 2);
  while (game.date.monthsElapsed < BUILDOUT + 2) {
    // Data Center Boom pauses for its connection decision; take the free option like the sim.
    const decision = pendingScenarioChoice(game);
    const difficulty = game.difficulty;
    if (decision)
      game = cloneDeep(
        gameReducer(
          game,
          chooseScenarioResponse({
            decisionId: decision.id,
            optionId: decision.options.find((o) => o.cost(difficulty) === 0)!
              .id,
          }),
        ),
      );
    month(game);
  }
  expect(program().adoption).toBe(1);
  expect(program().completedMonth).toBe(BUILDOUT + 2);
  const spent = program().spent;
  month(game);
  expect(program().spending).toBe(0);
  expect(program().spent).toBe(spent);
  const restored = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  expect(restored.policies).toEqual(game.policies);
  // Only build-outs finish, and never before the first month of play.
  const saved = () => cloneDeep(serializeSave(game));
  const operating = saved();
  operating.game.policies!.programs.timeOfUse.completedMonth = 3;
  expect(parseSave(operating)).toBeNull();
  const early = saved();
  early.game.policies!.programs.solar.completedMonth = 0;
  expect(parseSave(early)).toBeNull();
  // A finished build-out cannot carry a scheduled change.
  const rescheduled = saved();
  rescheduled.game.policies!.programs.solar.pending = {
    tier: "Off",
    month: rescheduled.game.date.monthsElapsed + 1,
  };
  expect(parseSave(rescheduled)).toBeNull();
});

test("efficiency cohorts save fully for ten years, then fade to nothing at twenty", () => {
  const program = {
    ...emptyPolicies().programs.efficiency,
    adoption: 1,
    installs: [
      [1, 0.5],
      [13, 0.5],
    ] as [number, number][],
  };
  expect(efficiencyInEffect(program, 121)).toBe(1);
  // The first cohort is halfway through its fade; the second, a year younger, is 60% intact.
  expect(efficiencyInEffect(program, 181)).toBeCloseTo(0.25 + 0.3);
  expect(efficiencyInEffect(program, 241)).toBeCloseTo(0.5 * (12 / 120));
  expect(efficiencyInEffect(program, 253)).toBe(0);
});

test("rooftop rebates follow the installed price of their year", () => {
  expect(residentialSolarCostPerW(2000)).toBeCloseTo(14);
  expect(residentialSolarCostPerW(2010)).toBeCloseTo(8.5);
  expect(residentialSolarCostPerW(2023)).toBeCloseTo(4.2);
  expect(residentialSolarCostPerW(2040)).toBeCloseTo(3.6);
  const perWatt = (scenarioId: number) => {
    const game = createGame({ scenarioId });
    return (
      policyTotalCost(game, "solar", 1) /
      (programCustomers(game) * POLICIES.solar.cap)
    );
  };
  // Start-year dollars: a quarter of the era's installed price per watt, plus a month of inflation.
  expect(perWatt(105) / (0.25 * residentialSolarCostPerW(2004))).toBeCloseTo(
    1,
    1,
  );
  expect(perWatt(106)).toBeLessThan(perWatt(105) / 2);
});

test("efficiency saves more where heating and cooling drive demand", () => {
  // A year of hourly forecast on the real demand path, with the whole pool installed.
  const savedShare = (scenarioId: number) => {
    const game = createGame({ scenarioId, seed: 4 });
    game.policies = emptyPolicies(game.date.monthsElapsed);
    Object.assign(game.policies.programs.efficiency, {
      tier: "On",
      adoption: 1,
      installs: [[game.date.monthsElapsed, 1]],
      completedMonth: game.date.monthsElapsed,
    });
    const now = game.timeline[0];
    const year = generateNewTimeline(
      game,
      now.cash,
      now.customers,
      (TICKS_PER_YEAR * TICK_MINUTES) / 240,
      240,
    );
    const total = (field: "efficiencySavedW" | "rebateEligibleW") =>
      year.reduce((sum, tick) => sum + (tick[field] ?? 0), 0);
    return total("efficiencySavedW") / total("rebateEligibleW");
  };
  const mild = savedShare(100); // San Francisco
  const extreme = savedShare(107); // Austin
  expect(mild).toBeGreaterThanOrEqual(POLICIES.efficiency.applianceSaving);
  expect(extreme).toBeGreaterThan(mild);
});
