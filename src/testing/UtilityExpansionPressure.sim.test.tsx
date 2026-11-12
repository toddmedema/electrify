import fs from "fs";
import { runSimulation } from "./Simulator";
import {
  expansionBalanceActions,
  EXPANSION_BALANCE_CASES,
} from "./UtilityExpansionBalanceFixtures";
import { expectNoViolations } from "./SimulationTestHelpers";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { INHERITED_CONNECTIONS } from "../helpers/PowerAgreements";
import type { MonthlyHistoryType } from "../Types";

jest.setTimeout(180000);
const evidence: object[] = [];
afterEach(() => {
  const path = process.env.ELECTRIFY_EXPANSION_PRESSURE_REPORT;
  if (path) fs.writeFileSync(path, JSON.stringify(evidence, null, 2));
});

const annualPurchases = (months: MonthlyHistoryType[]) => ({
  contractedMeanMW:
    months.reduce(
      (sum, month) => sum + (month.chartAverage?.entitlementImportedW ?? 0),
      0,
    ) /
    months.length /
    1e6,
  marketMeanMW:
    months.reduce(
      (sum, month) =>
        sum +
        (month.chartAverage?.importedW ?? 0) -
        (month.chartAverage?.entitlementImportedW ?? 0),
      0,
    ) /
    months.length /
    1e6,
  cost: months.reduce((sum, month) => sum + month.expensesImports, 0),
});

for (const seed of [12345, 1, 7])
  for (const target of ["valley-electric", "ridge-electric"] as const) {
    it(`${target} seed ${seed}: retained connections carry market purchases after the 2020 coverage loss`, () => {
      const fixture = EXPANSION_BALANCE_CASES.find(
        (item) => item.id === `${target}-unprepared`,
      )!;
      const result = runSimulation({
        scenarioId: 116,
        difficulty: "Employee",
        seed,
        scheduledActions: expansionBalanceActions(fixture, seed),
      });
      expectNoViolations(result);
      expect(result.finalUtilityExpansion?.acquisitions).toHaveLength(1);
      expect(result.builds).toHaveLength(0);
      const before = result.months.slice(168, 180);
      const after = result.months.slice(180, 192);
      expect(before).toHaveLength(12);
      expect(after).toHaveLength(12);
      const purchasesBefore = annualPurchases(before);
      const purchasesAfter = annualPurchases(after);
      expect(purchasesAfter.contractedMeanMW).toBeLessThan(
        purchasesBefore.contractedMeanMW,
      );
      expect(purchasesAfter.marketMeanMW).toBeGreaterThan(
        purchasesBefore.marketMeanMW,
      );
      expect(purchasesAfter.marketMeanMW).toBeGreaterThan(0);
      expect(purchasesAfter.cost).toBeGreaterThan(0);
      for (const utility of ["champlain", target] as const) {
        expect(
          result.finalTransmissionLines.find(
            (line) => line.corridorId === INHERITED_CONNECTIONS[utility],
          ),
        ).toMatchObject({
          capacityW: UTILITY_AREAS[utility].sourceInterfaceW,
          yearsToBuildLeft: 0,
          paused: false,
        });
      }
      evidence.push({
        seed,
        target,
        portfolio: "inherited-only",
        outcome: result.outcome,
        months: result.months.length,
        finalCash: result.finalCash,
        purchasesBefore,
        purchasesAfter,
      });
    });
    for (const purchaseMonth of [108, 110, 112])
      it(`${target} seed ${seed}: cash purchase remains viable in month ${purchaseMonth}`, () => {
        const fixture = EXPANSION_BALANCE_CASES.find(
          (item) => item.id === `${target}-mixed-cash`,
        )!;
        const actions = expansionBalanceActions(fixture, seed)
          .map((action) =>
            action.type === "acquire"
              ? { ...action, month: purchaseMonth }
              : action,
          )
          .sort((a, b) => a.month - b.month);
        const result = runSimulation({
          scenarioId: 116,
          difficulty: "CEO",
          seed,
          scheduledActions: actions,
        });
        expectNoViolations(result);
        expect(result.builds).toHaveLength(
          actions.filter((action) => action.type === "build").length,
        );
        expect(result.finalUtilityExpansion?.acquisitions).toHaveLength(1);
        expect(result.outcome).toBe("completed");
        expect(result.months).toHaveLength(240);
        evidence.push({
          seed,
          target,
          purchaseMonth,
          portfolio: "mixed-cash",
          outcome: result.outcome,
          finalCash: result.finalCash,
          lowestMonthEndCash: Math.min(
            ...result.months.map((month) => month.cash),
          ),
          builds: result.builds,
          lateOperatingCashFlow: result.months
            .map((month, index) => ({
              year: month.year,
              month: month.month,
              cash: month.cash,
              cashChange: index
                ? month.cash - result.months[index - 1].cash
                : 0,
            }))
            .slice(180),
        });
      });
  }
