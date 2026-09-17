import { runSimulation } from "./Simulator";
import { PolicyTier } from "../Types";

// Same seed, fleet, rates, and existing commitments. These are tradeoff checks, not a
// claim that a mathematical optimum replaces first-time-player testing.
describe.each([105, 106, 107])(
  "customer program balance in scenario %s",
  (scenarioId) => {
    test("Off, Small, Large and combined preserve accounting and trade cash for demand", () => {
      const play = (efficiency: PolicyTier, solar: PolicyTier) =>
        runSimulation({
          scenarioId,
          seed: 4,
          months: 12,
          initialPrograms: { efficiency, solar },
        });
      const off = play("Off", "Off");
      const small = play("Small", "Off");
      const large = play("Large", "Off");
      const solar = play("Off", "Large");
      const both = play("Large", "Large");
      [off, small, large, solar, both].forEach((result) =>
        expect(result.violations).toEqual([]),
      );
      // First effective month comparisons share identical customer assumptions and horizon.
      const baseline = off.months[1];
      expect(small.months[1].demandWh).toBeLessThan(baseline.demandWh);
      expect(large.months[1].demandWh).toBeLessThan(small.months[1].demandWh);
      expect(both.months[1].demandWh).toBeLessThan(large.months[1].demandWh);
      expect(both.months[1].cash).toBeLessThan(baseline.cash);
      const smallCost =
        small.months[1].expensesPolicy! /
        (baseline.demandWh - small.months[1].demandWh);
      const largeCost =
        large.months[1].expensesPolicy! /
        (baseline.demandWh - large.months[1].demandWh);
      expect(smallCost).toBeLessThan(largeCost);
      expect(off.months.every((m) => m.expensesPolicy === 0)).toBe(true);
    });
  },
);
