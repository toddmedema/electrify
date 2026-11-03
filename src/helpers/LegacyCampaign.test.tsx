import "../Store";
import { getStore } from "../StoreRegistry";
import type { RunSaveEffects } from "../SaveEffects";
import { encodeSave } from "../SaveEncoding";
import { GENERATORS } from "../data/Facilities";
import { hasEconomy, initEconomyFromCsv } from "../data/Economy";
import { loanBalanceAfterTicks } from "./Financials";
import { interpretScenarioRuleReport } from "./ScenarioRuleRuntime";
import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH, TICK_MINUTES } from "../Constants";
import { LEGACY_SCENARIOS } from "../data/LegacyCampaign";
import { getScenario } from "../data/Scenarios";
import { scenarioRules } from "./ScenarioRules";
import { MINUTES_PER_MONTH, summarizeTimeline } from "./DateTime";
import {
  gameObjectiveResults,
  scenarioObjectiveDefinitions,
  objectiveOwnedVintageFuels,
} from "./ObjectiveRules";
import { parseSave, serializeSave } from "../SaveGame";
import reducer, {
  continueLegacyCampaign,
  buildFacility,
  generateNewTimeline,
  start,
  tickState,
} from "../reducers/Game";
import { loadSimData } from "../testing/SimData";
import {
  firstCompany,
  closingCompany,
  closeProtocolGeneration,
} from "../testing/LegacyCampaignProtocolFixtures";
import { validLegacyCampaign } from "./LegacyCampaign";
import { isStorage } from "../Types";
import type { GameType, SaveGameType, VictoryType } from "../Types";

/** Continue validates the wire save before Loading downloads simulation data. */
function expectColdImport(save: SaveGameType): void {
  const wire = JSON.parse(JSON.stringify(encodeSave(save)));
  initEconomyFromCsv("");
  try {
    expect(hasEconomy()).toBe(false);
    if (!parseSave(wire))
      throw new Error(
        `Cold import failed for generation ${save.game.campaign?.generationIndex}`,
      );
  } finally {
    loadSimData(save.game.location);
  }
}

test("campaign initialization uses the native unranked setup and rejects forged progress", () => {
  const game = firstCompany();
  expectColdImport(serializeSave(game));
  expect(game.campaign?.generationIndex).toBe(0);
  expect(game.campaign?.openingCustomers).toBe(100);
  expect(game.runIdentity).toBeUndefined();
  expect(validLegacyCampaign(game)).toBe(true);
  expect(parseSave(serializeSave(game))).not.toBeNull();
  const forged = cloneDeep(serializeSave(game));
  forged.game.campaign!.termStartMonth = 240;
  expect(parseSave(forged)).toBeNull();
  for (const field of [
    "peakMW",
    "northCapacityMW",
    "emissionsBudgetTonnes",
    "inheritedDemandMultiplier",
  ] as const) {
    const changed = cloneDeep(serializeSave(game));
    changed.game.campaign![field] += 1;
    expect(parseSave(changed)).toBeNull();
  }
});

test("oil retirement counts paused commissioned equipment, excludes replacements, and deduplicates cohort facts", () => {
  const game = firstCompany();
  const generator = game.facilities[0];
  if (isStorage(generator))
    throw new Error("Expected the starting steam generator");
  game.facilities = [2000, 2001, undefined].map((year, index) => ({
    ...generator,
    id: index + 1,
    fuel: "Oil",
    paused: true,
    minuteOperational:
      year === undefined ? undefined : (year - 1882) * 12 * MINUTES_PER_MONTH,
  }));
  const objectives = scenarioObjectiveDefinitions(LEGACY_SCENARIOS[7]);
  const cohortGoal = objectives.find(
    (goal) => goal.metric === "fuelRetirement",
  )!;
  expect(
    objectiveOwnedVintageFuels(game, [
      cohortGoal,
      { ...cohortGoal, id: "second-oil-deadline" },
    ]),
  ).toEqual([{ fuel: "Oil", commissionedBeforeYear: 2001, count: 1 }]);
  game.facilities.shift();
  expect(objectiveOwnedVintageFuels(game, [cohortGoal])[0].count).toBe(0);
});

test("only the scheduled 20-year boundary pauses for a CEO handover and continuation preserves the company", () => {
  const game = closingCompany();
  expect(game.date.monthsElapsed).toBe(240);
  expect(game.campaign?.pendingHandover).toBe(true);
  expect(game.campaign?.completedTerms).toHaveLength(1);
  expect(
    gameObjectiveResults(game).every(
      (result) => !result.required || result.status === "completed",
    ),
  ).toBe(true);
  const minute = game.date.minute;
  tickState(game);
  expect(game.date.minute).toBe(minute);
  expect(parseSave(serializeSave(game))).not.toBeNull();
  const next = reducer(game, continueLegacyCampaign());
  expect(next.scenarioId).toBe(118);
  expect(next.date).toEqual(game.date);
  expect(next.startingYear).toBe(1882);
  expect(next.facilities).toEqual(game.facilities);
  expect(next.customerMarketSize).toBe(game.customerMarketSize);
  expect(next.customerRate).toBe(game.customerRate);
  expect(next.dollarsPerkWh).toBe(game.dollarsPerkWh);
  expect(next.timeline[0].cash).toBe(game.timeline[0].cash);
  expect(next.campaign?.openingCustomers).toBe(
    next.campaign?.completedTerms[0].closingCustomers,
  );
  expect(validLegacyCampaign(next)).toBe(true);
  expect(next.campaign?.pendingHandover).toBe(false);
  expect(next.campaign?.inheritedDemandMultiplier).toBeCloseTo(2.025);
  expect(next.objectiveProgress?.completedMonths).toBe(0);
  expect(next.objectiveProgress?.retentionBaseline).toBe(
    game.timeline[0].customers,
  );
  expect(parseSave(serializeSave(next))).not.toBeNull();
  const rules = scenarioRules(getScenario(next.scenarioId), next)!;
  expect(rules.events[0].startMonth).toBeGreaterThanOrEqual(240);
  expect(
    rules.objectives.find(
      (objective) => objective.metric === "customerRetention",
    ),
  ).toMatchObject({ deadlineMonth: 239 });
});

test("a paused handover preserves customers and price memory before forecasting future ticks", () => {
  const game = closingCompany();
  const closing = game.timeline[0];
  closing.customerRate = 0.3;
  closing.customerBillingRate = 0.24;

  const next = reducer(game, continueLegacyCampaign());

  expect(next.date.minute).toBe(game.date.minute);
  expect(next.timeline[0].customers).toBe(closing.customers);
  expect(next.timeline[0].customerRate).toBe(closing.customerRate);
  expect(next.timeline[0].customerBillingRate).toBe(
    closing.customerBillingRate,
  );
  expect(next.timeline[1].customers).not.toBe(closing.customers);
  expect(next.timeline[1].customerRate).toBeLessThan(closing.customerRate);
});

test("archived completion is checked against evidence and loading resumes the same next tick", () => {
  const game = reducer(closingCompany(), continueLegacyCampaign());
  const original = cloneDeep(serializeSave(game));
  const forged = cloneDeep(original);
  forged.game.campaign!.completedTerms[0].objectiveResults[0].observed = 0;
  expect(parseSave(forged)).toBeNull();
  const restored = parseSave(original)!.game;
  const left = cloneDeep(game),
    right = cloneDeep(restored);
  tickState(left);
  tickState(right);
  expect(right).toEqual(left);
});

test("starting a later campaign link begins the first generation with no inherited state", () => {
  const game = reducer(firstCompany(), start(125));
  expect(game.scenarioId).toBe(117);
  expect(game.inGame).toBe(false);
  expect(game.date.minute).toBe(0);
  expect(game.campaign).toBeUndefined();
  expect(game.facilities).toEqual([]);
});

test("late CEO reports keep bounded local windows in both linked and standalone contexts", () => {
  const game = firstCompany();
  const scenario = LEGACY_SCENARIOS[5];
  const row = summarizeTimeline(game.timeline, 1882);
  const months = Array.from({ length: 12 }, (_, month) => ({
    ...row,
    year: 2001,
    month: month + 1,
  }));
  const campaign = {
    ...game.campaign!,
    generationIndex: 5,
    termStartMonth: 1200,
  };
  const linked = scenarioRules(scenario, { ...game, campaign })!;
  const local = scenarioRules(scenario, {
    difficulty: game.difficulty,
    seed: game.seed,
  })!;
  const report = {
    id: "late-service",
    kind: "reliability" as const,
    fromMonth: 228,
    throughMonth: 239,
  };
  expect(
    interpretScenarioRuleReport(report, local, {
      startingYear: 1982,
      completedMonths: 240,
      monthlyHistory: months,
    }).available,
  ).toBe(true);
  expect(
    interpretScenarioRuleReport(
      { ...report, fromMonth: 1428, throughMonth: 1439 },
      linked,
      {
        startingYear: 1882,
        completedMonths: 1440,
        monthlyHistory: months,
      },
    ).available,
  ).toBe(true);
});

test("a resumed later generation does not mistake missing presentation history for an unclosed month", () => {
  const game = cloneDeep(reducer(closingCompany(), continueLegacyCampaign()));
  game.monthlyHistory = [];
  const restored = parseSave(serializeSave(game));
  expect(restored).not.toBeNull();
  tickState(restored!.game);
  expect(restored!.game.monthlyHistory).toEqual([]);
  expect(restored!.game.objectiveProgress?.completedMonths).toBe(0);
});

test("all nine generations retain bounded, verifiable saves past 1200 global months", () => {
  jest.useFakeTimers();
  try {
    let game = firstCompany();
    const outcomes: VictoryType[] = [];
    const saveEffects: RunSaveEffects = {
      outcome: (victory) => outcomes.push(victory),
    };
    const handovers: { before: GameType; after: GameType }[] = [];
    for (let index = 0; index < 9; index++) {
      game = closeProtocolGeneration(game, saveEffects);
      expect(game.date.monthsElapsed).toBe((index + 1) * 240);
      expect(game.campaign?.completedTerms).toHaveLength(index + 1);
      expect(game.objectiveProgress?.completedMonths).toBe(240);
      expect(game.campaign?.pendingHandover).toBe(index < 8);
      const save = cloneDeep(serializeSave(game));
      if (!parseSave(save))
        throw new Error(`Protocol save rejected after term ${index + 1}`);
      expectColdImport(save);
      expect(
        parseSave(JSON.parse(JSON.stringify(encodeSave(save)))),
      ).not.toBeNull();
      const fakeClock = cloneDeep(save);
      fakeClock.game.campaign!.termStartMonth += 240;
      expect(parseSave(fakeClock)).toBeNull();
      const fakeBaseline = cloneDeep(save);
      fakeBaseline.game.campaign!.referenceRate *= 2;
      expect(parseSave(fakeBaseline)).toBeNull();
      const fakePlace = cloneDeep(save);
      fakePlace.game.location = {
        ...game.location,
        id: "Paris",
        lat: 48.8566,
        long: 2.3522,
      };
      expect(parseSave(fakePlace)).toBeNull();
      if (index < 8) {
        const before = game;
        game = cloneDeep(reducer(game, continueLegacyCampaign()));
        handovers.push({ before, after: game });
      }
    }
    expect(handovers).toHaveLength(8);
    for (const { before, after } of handovers) {
      expect(after.facilities).toEqual(before.facilities);
      expect(after.date).toEqual(before.date);
      expect(after.campaign?.openingCustomers).toBe(
        before.timeline[0].customers,
      );
      expect(after.campaign?.openingCash).toBe(before.timeline[0].cash);
      expect(after.objectiveProgress?.completedMonths).toBe(0);
      expect(parseSave(serializeSave(after))).not.toBeNull();
    }
    expect(game.date.year).toBe(2062);
    expect(game.runIdentity).toBeUndefined();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe("completed");
    expect(game.campaign?.openingCash).not.toBe(LEGACY_SCENARIOS[8].cash);
    expect(outcomes[0].debrief?.startingCash).toBe(game.campaign?.openingCash);
    expect(outcomes[0].debrief?.startingFleet).toEqual(
      game.campaign?.openingFleet,
    );
    jest.advanceTimersByTime(1);
    expect(getStore().getState().ui.victory?.debrief?.startingCash).toBe(
      game.campaign?.openingCash,
    );
    expect(getStore().getState().ui.victory?.debrief?.startingFleet).toEqual(
      game.campaign?.openingFleet,
    );
    for (let tick = 0; tick < MINUTES_PER_MONTH / TICK_MINUTES; tick++)
      tickState(game);
    expect(game.date.monthsElapsed).toBe(2161);
    expect(game.campaign?.completedTerms).toHaveLength(9);
    expect(parseSave(serializeSave(game))).not.toBeNull();
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("campaign purchases reject unavailable, undersized, oversized, and wrong-era quotes", () => {
  const game = firstCompany();
  const quote = GENERATORS(game, 100000, [], []).find(
    (quote) => quote.name === "Coal",
  )!;
  const rejected = [
    { ...quote, available: false },
    { ...quote, peakW: 10000 },
    { ...quote, peakW: 1000000 },
    { ...quote, btuPerWh: 8.638 },
  ];
  for (const facility of rejected) {
    const next = reducer(game, buildFacility({ facility, financed: true }));
    expect(next.facilities).toEqual(game.facilities);
    expect(next.timeline[0].cash).toBe(game.timeline[0].cash);
  }
  expect(
    reducer(game, buildFacility({ facility: quote, financed: true }))
      .facilities,
  ).toHaveLength(game.facilities.length + 1);
});

test("a campaign failure debrief keeps the actual CEO opening company", () => {
  jest.useFakeTimers();
  try {
    const game = firstCompany();
    const outcomes: VictoryType[] = [];
    game.timeline = generateNewTimeline(game, -1e12, 100);
    for (let tick = 0; tick < TICKS_PER_MONTH; tick++)
      tickState(game, { outcome: (victory) => outcomes.push(victory) });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe("bankrupt");
    expect(outcomes[0].debrief?.startingCash).toBe(game.campaign?.openingCash);
    expect(outcomes[0].debrief?.startingFleet).toEqual(
      game.campaign?.openingFleet,
    );
    jest.advanceTimersByTime(1);
    expect(getStore().getState().ui.victory?.debrief?.startingCash).toBe(
      game.campaign?.openingCash,
    );
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});

test("monthly campaign pre-rolls cannot make extra loan payments", () => {
  let game = firstCompany();
  const quote = GENERATORS(game, 100000, [], []).find(
    (quote) => quote.name === "Coal",
  )!;
  game = cloneDeep(
    reducer(game, buildFacility({ facility: quote, financed: true })),
  );
  const financed = game.facilities.find(
    (facility) => facility.loanAmountLeft > 0,
  )!;
  const principal = financed.loanAmountLeft;
  const expected = loanBalanceAfterTicks(
    principal,
    financed.loanMonthlyPayment,
    financed.interestRate,
    TICKS_PER_MONTH * 12,
  );
  for (let tick = 0; tick < TICKS_PER_MONTH * 12; tick++) tickState(game);
  expect(game.date.monthsElapsed).toBe(12);
  expect(
    game.facilities.find((facility) => facility.id === financed.id)!
      .loanAmountLeft,
  ).toBeCloseTo(expected, 5);
});
