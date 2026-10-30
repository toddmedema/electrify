import compatibility from "../data/RunCompatibility.json";
import fs from "fs";
import { DIFFICULTY_IDS } from "../Constants";
import { acquisitionAssets } from "../helpers/Expansion";
import { facilityCashBack } from "../helpers/Financials";
import { UTILITY_TARGETS } from "../data/UtilityExpansion";
import { DifficultyType } from "../Types";
import { expectNoViolations } from "./SimulationTestHelpers";
import { createGame, runSimulation } from "./Simulator";
import {
  EXPANSION_BALANCE_CASES,
  expansionBalanceActions,
} from "./UtilityExpansionBalanceFixtures";

jest.setTimeout(180000);
const fullMatrix = process.env.ELECTRIFY_EXPANSION_BALANCE === "full";
const difficulties: readonly DifficultyType[] = fullMatrix
  ? DIFFICULTY_IDS
  : ["Employee", "CEO"];
const seeds = fullMatrix ? [12345, 1, 7] : [12345];
const cases = fullMatrix
  ? EXPANSION_BALANCE_CASES
  : EXPANSION_BALANCE_CASES.filter(
      ({ id }) =>
        id === "valley-electric-firm-loan" ||
        id === "ridge-electric-mixed-cash" ||
        id === "both-firm-loan",
    );
const evidence: object[] = [];
const audits: object[] = [];

const writeEvidence = () => {
  if (process.env.ELECTRIFY_EXPANSION_BALANCE_REPORT)
    fs.writeFileSync(
      process.env.ELECTRIFY_EXPANSION_BALANCE_REPORT,
      JSON.stringify(
        {
          fullMatrix,
          expectedCases: difficulties.length * seeds.length * cases.length,
          recordedCases: evidence.length,
          compatibilityId: compatibility.compatibilityId,
          sourceRevision: process.env.ELECTRIFY_EXPANSION_BALANCE_REVISION,
          cases: evidence,
          assetAudits: audits,
        },
        null,
        2,
      ) + "\n",
    );
};
afterEach(writeEvidence);
afterAll(writeEvidence);

it.each(DIFFICULTY_IDS)(
  "bounds original and acquired residual values at %s",
  (difficulty) => {
    const game = createGame({ scenarioId: 116, difficulty, seed: 12345 });
    const openingResale = game.facilities.reduce(
      (sum, asset) => sum + facilityCashBack(asset, 0),
      0,
    );
    const purchased = UTILITY_TARGETS.map((target) => {
      const assets = acquisitionAssets(game, target.id)!;
      expect(assets).toHaveLength(3);
      const residual = assets.reduce(
        (sum, asset) => sum + facilityCashBack(asset, 0),
        0,
      );
      expect(residual).toBeLessThanOrEqual(
        target.equityPrice + target.assumedDebt,
      );
      return {
        targetId: target.id,
        residual,
        enterpriseValue: target.equityPrice + target.assumedDebt,
      };
    });
    audits.push({ difficulty, openingResale, purchased });
  },
);

for (const difficulty of difficulties)
  for (const seed of seeds) {
    it.each(cases)(`${difficulty} seed ${seed}: $id`, (fixture) => {
      const scheduledActions = expansionBalanceActions(fixture, seed);
      const result = runSimulation({
        scenarioId: 116,
        difficulty,
        seed,
        months: 240,
        endOnDecidedObjective: false,
        scheduledActions,
      });
      const demandWh = result.months.reduce(
        (sum, month) => sum + month.demandWh,
        0,
      );
      const supplyWh = result.months.reduce(
        (sum, month) => sum + month.supplyWh,
        0,
      );
      evidence.push({
        difficulty,
        seed,
        case: fixture.id,
        portfolio: fixture.portfolio,
        months: result.months.length,
        violations: result.violationCountByRule,
        outcome: result.outcome,
        physicallySurvived: result.physicallySurvived,
        consolidatedImportWh: result.consolidatedImportWh,
        finalCash: result.finalCash,
        finalDebt: result.finalDebt,
        finalNetWorth: result.finalNetWorth,
        customers: result.finalUtilityExpansion?.areas.map(
          ({ id, customers, transferredCustomers, retentionLowWatermark }) => ({
            id,
            customers,
            transferredCustomers,
            retentionLowWatermark,
          }),
        ),
        acquisitions: result.finalUtilityExpansion?.acquisitions,
        builds: result.builds,
        demandWh,
        supplyWh,
        servedFraction: supplyWh / demandWh,
        importExpenses: result.months.reduce(
          (sum, month) => sum + month.expensesImports,
          0,
        ),
        kgco2e: result.months.reduce((sum, month) => sum + month.kgco2e, 0),
        minimumMarginW: Math.min(
          ...result.months.map(
            (month) => month.minimumSupplyMarginW ?? Infinity,
          ),
        ),
        areas: result.expansionAreaMetrics,
        objectives: result.objectiveResults,
        reached2017: result.months.length >= 145,
        reachedRetirementDeadline: result.months.length >= 228,
        reachedFinalRetention: result.months.length === 240,
      });
      expectNoViolations(result);
      expect(result.builds).toHaveLength(
        scheduledActions.filter(
          (action) =>
            action.type === "build" && action.month < result.months.length,
        ).length,
      );
      expect(result.finalUtilityExpansion?.acquisitions.length).toBe(
        fixture.portfolio === "line-only"
          ? 0
          : fixture.portfolio === "both"
            ? 2
            : 1,
      );
      const mustComplete = ["firm", "mixed", "both"].includes(
        fixture.portfolio,
      );
      expect({
        months: result.months.length,
        outcome: result.outcome,
      }).toMatchObject(
        mustComplete ? { months: 240, outcome: "completed" } : {},
      );
    });
  }
