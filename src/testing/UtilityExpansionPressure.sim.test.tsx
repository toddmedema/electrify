import fs from "fs";
import { runSimulation } from "./Simulator";
import {
  expansionBalanceActions,
  EXPANSION_BALANCE_CASES,
} from "./UtilityExpansionBalanceFixtures";
import { expectNoViolations } from "./SimulationTestHelpers";

jest.setTimeout(180000);
const evidence: object[] = [];
afterEach(() => {
  const path = process.env.ELECTRIFY_EXPANSION_PRESSURE_REPORT;
  if (path) fs.writeFileSync(path, JSON.stringify(evidence, null, 2));
});

for (const seed of [12345, 1, 7])
  for (const target of ["valley-electric", "ridge-electric"]) {
    it(`${target} seed ${seed}: inherited supply alone cannot coast through the 2020 withdrawal`, () => {
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
      expect(result.months.length).toBeGreaterThanOrEqual(180);
      expect(result.months.length).toBeLessThan(192);
      expect(result.outcome).toBe("fired");
      evidence.push({
        seed,
        target,
        portfolio: "inherited-only",
        outcome: result.outcome,
        months: result.months.length,
        finalCash: result.finalCash,
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
