import { runSimulation, ScheduledSimActionType } from "./Simulator";
import { LEGACY_CAMPAIGN_ID } from "../data/LegacyCampaign";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "./Simulator";
import {
  officialCommand,
  officialQuote,
} from "./OfficialScenarioExecutionFixtures";
import { getMarketRate } from "../helpers/Customers";
import { legacyMarketReferenceRate } from "../helpers/LegacyCampaign";
import { currentTick } from "../helpers/GameSelectors";
import { getScenario } from "../data/Scenarios";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import {
  buildFacility,
  continueLegacyCampaign,
  delta,
  hasChronicBlackouts,
  sellFacility,
  tickState,
} from "../reducers/Game";
import { DIFFICULTY_IDS, TICKS_PER_MONTH } from "../Constants";
import type { DifficultyType } from "../Types";
import { parseSave, serializeSave } from "../SaveGame";

const thermalPlan: ScheduledSimActionType[] = [
  {
    month: 0,
    type: "build",
    build: { name: "Coal", peakW: 100000, financed: true },
  },
  {
    month: 120,
    type: "build",
    build: { name: "Coal", peakW: 50000, financed: true },
  },
];

const hydroPlan: ScheduledSimActionType[] = [
  ...thermalPlan,
  {
    month: 157,
    type: "build",
    build: { name: "Hydro", peakW: 100000, financed: true },
  },
];

test.each(
  DIFFICULTY_IDS.flatMap((difficulty) => [
    {
      name: "incremental steam",
      actions: thermalPlan,
      hydro: false,
      difficulty,
    },
    {
      name: "steam followed by hydro",
      actions: hydroPlan,
      hydro: true,
      difficulty,
    },
  ]),
)(
  "First Light supports $name on $difficulty through a real 20-year generation",
  ({ actions, hydro, difficulty }) => {
    const result = runSimulation({
      scenarioId: LEGACY_CAMPAIGN_ID,
      difficulty,
      seed: 611,
      months: 240,
      scheduledActions: actions,
    });
    expect({
      outcome: result.outcome,
      months: result.months.length,
      bankruptAt: result.bankruptAtMonth,
      firedAt: result.firedAtMonth,
      cash: result.finalCash >= 0,
      violations: result.violations.slice(0, 3),
    }).toEqual({
      outcome: "completed",
      months: 240,
      bankruptAt: null,
      firedAt: null,
      cash: true,
      violations: [],
    });
    expect(
      result.objectiveResults.every(
        (goal) => !goal.required || goal.status === "completed",
      ),
    ).toBe(true);
    expect(
      result.finalFacilities.some((facility) => facility.fuel === "Hydro"),
    ).toBe(hydro);
    expect(result.months.at(-1)!.customers).toBeGreaterThanOrEqual(90);
  },
);

test.each<{ difficulty: DifficultyType; steamFirst: boolean }>([
  { difficulty: "Manager", steamFirst: false },
  { difficulty: "Employee", steamFirst: false },
  { difficulty: "CEO", steamFirst: false },
  { difficulty: "Manager", steamFirst: true },
])(
  "a single $difficulty company operates through all nine generations (steam first: $steamFirst)",
  ({ difficulty, steamFirst }) => {
    let game = cloneDeep(
      createGame({
        scenarioId: LEGACY_CAMPAIGN_ID,
        difficulty,
        seed: 611,
      }),
    );
    const builds = new Map([
      [0, { name: "Coal", peakW: 100000, financed: true }],
      [120, { name: "Coal", peakW: 50000, financed: true }],
      [157, { name: "Hydro", peakW: 750000, financed: true }],
      [240, { name: "Coal", peakW: 200000, financed: true }],
      [600, { name: "Hydro", peakW: 1500000, financed: false }],
      [720, { name: "Oil", peakW: 1000000, financed: false }],
      [936, { name: "Geothermal", peakW: 2000000, financed: false }],
      [1440, { name: "Geothermal", peakW: 8000000, financed: true }],
      [1680, { name: "Geothermal", peakW: 20000000, financed: true }],
      [1920, { name: "Enhanced Geothermal", peakW: 40000000, financed: true }],
    ]);
    if (steamFirst) {
      builds.delete(157);
      builds.set(241, { name: "Hydro", peakW: 750000, financed: true });
      builds.delete(600);
      builds.set(504, { name: "Hydro", peakW: 1500000, financed: false });
    }
    if (difficulty === "CEO") {
      builds.set(936, { name: "Geothermal", peakW: 1000000, financed: false });
    }
    const savedHandovers: boolean[] = [];
    for (let month = 0; month < 2160; month++) {
      const scenario = getScenario(game.scenarioId)!;
      game = officialCommand(
        game,
        delta({
          dollarsPerkWh: getMarketRate(
            legacyMarketReferenceRate(game, scenario),
            game.date,
            game.startingYear,
            game.seed,
          ),
        }),
      );
      const build = builds.get(month);
      if (build) {
        const before = game.facilities.length;
        game = officialCommand(
          game,
          buildFacility({
            facility: officialQuote(game, build),
            financed: build.financed,
          }),
        );
        if (game.facilities.length !== before + 1)
          throw new Error(
            `Rejected ${build.name} purchase at month ${month}: cash ${currentTick(game)?.cash}`,
          );
      }
      if (month === 270) {
        for (const facility of game.facilities.filter(
          (facility) =>
            facility.fuel === "Coal" && (facility.btuPerWh ?? 0) > 35,
        ))
          game = officialCommand(game, sellFacility(facility.id));
      }
      if (month === 1512) {
        for (const facility of game.facilities.filter(
          (facility) => facility.fuel === "Coal" || facility.fuel === "Oil",
        ))
          game = officialCommand(game, sellFacility(facility.id));
      }
      for (let tick = 0; tick < TICKS_PER_MONTH; tick++) tickState(game);
      const failed = gameObjectiveResults(game).find(
        (goal) => goal.required && goal.status === "failed",
      );
      if (
        (currentTick(game)?.cash ?? -1) < 0 ||
        hasChronicBlackouts(game.monthlyHistory, game.difficulty) ||
        failed
      ) {
        throw new Error(
          JSON.stringify({
            month: month + 1,
            year: game.date.year,
            cash: currentTick(game)?.cash,
            customers: currentTick(game)?.customers,
            failed,
            history: game.monthlyHistory
              .slice(0, 3)
              .map(
                ({
                  peakDemandW,
                  demandWh,
                  supplyWh,
                  revenue,
                  expensesOM,
                  expensesInterest,
                }) => ({
                  peakDemandW,
                  demandWh,
                  supplyWh,
                  revenue,
                  expensesOM,
                  expensesInterest,
                }),
              ),
            terms: game.campaign?.completedTerms.map((term) => ({
              generationIndex: term.generationIndex,
              closingCash: term.closingCash,
              closingCustomers: term.closingCustomers,
            })),
          }),
        );
      }
      if (game.campaign?.pendingHandover) {
        savedHandovers.push(parseSave(serializeSave(game)) !== null);
        game = officialCommand(game, continueLegacyCampaign());
      }
    }
    expect(game.date.monthsElapsed).toBe(2160);
    expect(game.campaign?.completedTerms).toHaveLength(9);
    expect(savedHandovers).toEqual(Array(8).fill(true));
    expect(parseSave(serializeSave(game))).not.toBeNull();
  },
  180000,
);
