import compatibility from "../data/RunCompatibility.json";
import fs from "fs";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { DIFFICULTY_IDS } from "../Constants";
import { acquisitionAssets, utilityAcquisitions } from "../helpers/Expansion";
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
        id === "valley-electric-mixed-cash" ||
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
      for (const [key, expected] of [
        ["demandWh", demandWh],
        ["supplyWh", supplyWh],
        ["kgco2e", result.months.reduce((sum, month) => sum + month.kgco2e, 0)],
      ] as const) {
        expect(
          Math.abs(result.companyMetrics![key] - expected),
        ).toBeLessThanOrEqual(Math.max(1, expected * 1e-12));
      }
      const acquisitions = utilityAcquisitions({
        utilityExpansion: result.finalUtilityExpansion,
        territoryNetwork: result.finalTerritoryNetwork,
      });
      evidence.push({
        difficulty,
        seed,
        case: fixture.id,
        portfolio: fixture.portfolio,
        months: result.months.length,
        violations: result.violationCountByRule,
        outcome: result.outcome,
        physicallySurvived: result.physicallySurvived,
        companyMetrics: result.companyMetrics,
        finalCash: result.finalCash,
        finalDebt: result.finalDebt,
        finalNetWorth: result.finalNetWorth,
        customers: result.months.at(-1)?.customers,
        retentionBaseline: result.retentionBaseline,
        retainedShare:
          (result.months.at(-1)?.customers ?? 0) / result.retentionBaseline!,
        acquisitions,
        builds: result.builds,
        scheduledBuilds: scheduledActions.filter(
          (action) => action.type === "build",
        ),
        scheduledAcquisitions: scheduledActions.filter(
          (action) => action.type === "acquire",
        ),
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
        objectives: result.objectiveResults,
        reached2017: result.months.length >= 145,
        reachedAcquisitionDeadline: result.months.length >= 120,
        reachedFinalRetention: result.months.length === 240,
      });
      expect(result.retentionBaseline).toBeCloseTo(
        90000 +
          acquisitions.reduce(
            (sum, receipt) =>
              sum +
              (receipt.minute <
              result.scenario.durationMonths * MINUTES_PER_MONTH
                ? receipt.transferredCustomers
                : 0),
            0,
          ),
        6,
      );
      expectNoViolations(result);
      expect(result.builds).toHaveLength(
        scheduledActions.filter(
          (action) =>
            action.type === "build" && action.month < result.months.length,
        ).length,
      );
      expect(result.finalUtilityExpansion?.acquisitions.length).toBe(
        fixture.portfolio === "standalone"
          ? 0
          : fixture.portfolio === "both"
            ? 2
            : 1,
      );
      const mustComplete = ["firm", "mixed", "both"].includes(
        fixture.portfolio,
      );
      expect(
        result.objectiveResults?.find(
          ({ metric }) => metric === "utilityOwnership",
        ),
      ).toMatchObject(
        mustComplete
          ? { status: "completed", observed: 3, target: 3 }
          : { target: 3 },
      );
      expect({
        months: result.months.length,
        outcome: result.outcome,
      }).toMatchObject(
        mustComplete ? { months: 240, outcome: "completed" } : {},
      );
    });
  }
