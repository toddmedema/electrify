import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH, TICK_MINUTES } from "../Constants";
import type { GameType } from "../Types";
import type { RunSaveEffects } from "../SaveEffects";
import { getScenario } from "../data/Scenarios";
import { LEGACY_SCENARIOS } from "../data/LegacyCampaign";
import { resolveStoryAtDate } from "../data/WorldEvents";
import {
  getDateFromMinute,
  MINUTES_PER_MONTH,
  summarizeTimeline,
} from "../helpers/DateTime";
import { getScenarioLocation } from "../helpers/Locations";
import {
  recordGameObjectiveMonth,
  scenarioObjectiveDefinitions,
} from "../helpers/ObjectiveRules";
import { scenarioRules } from "../helpers/ScenarioRules";
import { buildStorySnapshot } from "../helpers/Story";
import reducer, {
  generateNewTimeline,
  initGame,
  start,
  tickState,
} from "../reducers/Game";
import { loadSimData } from "./SimData";

export function firstCompany(): GameType {
  const scenario = LEGACY_SCENARIOS[0];
  const location = getScenarioLocation(scenario)!;
  loadSimData(location);
  return cloneDeep(
    reducer(
      reducer(undefined, start(scenario.id)),
      initGame({
        facilities: scenario.facilities,
        cash: 1e9,
        customers: 100,
        location,
        seed: 611,
      }),
    ),
  );
}

/** Fabricated public month facts isolate the protocol; the final month uses real ticks. */
export function closingCompany(firstMonthCustomers = 100): GameType {
  const game = firstCompany();
  const row = summarizeTimeline(game.timeline, 1882);
  for (let month = 0; month < 239; month++) {
    game.date = getDateFromMinute((month + 1) * MINUTES_PER_MONTH, 1882);
    const closed = {
      ...row,
      year: 1882 + Math.floor(month / 12),
      month: (month % 12) + 1,
      customers: month === 0 ? firstMonthCustomers : 100,
      cash: 1e9,
      // Protocol evidence only: real economic feasibility is exercised by the sim suite.
      revenue: row.expensesFuel + row.expensesOM + row.expensesInterest + 1e6,
    };
    game.monthlyHistory.unshift(closed);
    recordGameObjectiveMonth(game, closed);
    const resolved = resolveStoryAtDate({
      rules: scenarioRules(LEGACY_SCENARIOS[0], game),
      scenarioId: game.scenarioId,
      difficulty: game.difficulty,
      seed: game.seed,
      date: game.date,
      location: game.location,
      snapshot: buildStorySnapshot(
        game.monthlyHistory,
        game.facilities,
        game.date.minute,
      ),
      occurrences: game.worldEvents.occurrences,
    });
    game.worldEvents.occurrences.push(...resolved.occurrences);
    game.worldEvents.active = resolved.active;
  }
  game.timeline = generateNewTimeline(game, 1e9, 100);
  for (let tick = 0; tick < TICKS_PER_MONTH; tick++) tickState(game);
  return game;
}

/** Evidence fixtures isolate the handover protocol; full economics use the headless campaigns. */
export function closeProtocolGeneration(
  opening: GameType,
  saveEffects?: RunSaveEffects,
): GameType {
  const game = cloneDeep(opening);
  const campaign = game.campaign!;
  const growthGoal = scenarioObjectiveDefinitions(
    getScenario(game.scenarioId),
    game,
  ).find((goal) => goal.metric === "customerCount");
  const customers =
    growthGoal?.metric === "customerCount"
      ? Math.max(campaign.openingCustomers, growthGoal.minCustomers * 1.01)
      : campaign.openingCustomers;
  const row = summarizeTimeline(game.timeline, 1882);
  game.dollarsPerkWh = 0;
  game.customerRate = 0;
  for (let local = 0; local < 239; local++) {
    const month = campaign.termStartMonth + local;
    game.date = getDateFromMinute((month + 1) * MINUTES_PER_MONTH, 1882);
    const closed = {
      ...row,
      year: 1882 + Math.floor(month / 12),
      month: (month % 12) + 1,
      customers,
      cash: 1e12,
      revenue: campaign.generationIndex === 0 ? 1e6 : 0,
      revenueExports: 0,
      revenueGrants: 0,
      supplyWh: 1e12,
      demandWh: 1e12,
      kgco2e: 0,
      localKgco2e: 0,
      importedKgco2e: 0,
      constructionKgco2e: 0,
      expensesFuel: 0,
      expensesOM: 0,
      expensesInterest: 0,
      expensesImports: 0,
      expensesPolicy: 0,
      expensesCarbonFee: 0,
      minimumSupplyMarginW: 1e12,
      efficiencySavedWh: 1e11,
      efficiencyEligibleWh: 1e12,
      eveningDemandWh: 1e12,
      eveningUnservedWh: 0,
    };
    game.monthlyHistory.unshift(closed);
    recordGameObjectiveMonth(game, closed);
    const resolved = resolveStoryAtDate({
      rules: scenarioRules(getScenario(game.scenarioId), game),
      scenarioId: game.scenarioId,
      difficulty: game.difficulty,
      seed: game.seed,
      date: game.date,
      location: game.location,
      snapshot: buildStorySnapshot(
        game.monthlyHistory,
        game.facilities,
        game.date.minute,
      ),
      occurrences: game.worldEvents.occurrences,
    });
    game.worldEvents.occurrences.push(...resolved.occurrences);
    game.worldEvents.active = resolved.active;
  }
  game.timeline = generateNewTimeline(game, 1e12, customers);
  game.timeline.forEach((tick) => {
    tick.cash = 1e12;
    tick.customers = customers;
    tick.customerRate = 0;
    tick.customerBillingRate = 0;
    // This fixture isolates the save protocol; realistic evening dispatch uses the sim playbooks.
    tick.supplyW = tick.demandW;
  });
  game.date = getDateFromMinute(
    (campaign.termStartMonth + 240) * MINUTES_PER_MONTH - TICK_MINUTES,
    1882,
  );
  tickState(game, saveEffects);
  return game;
}
