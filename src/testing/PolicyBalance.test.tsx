import { runSimulation } from "./Simulator";
import { PolicyTier } from "../Types";
import { POLICIES } from "../data/Policies";

const BUILDOUT = POLICIES.efficiency.buildoutMonths;
// Month 1 is the first effective month, so a full build-out spends through month BUILDOUT.
const MONTHS = BUILDOUT + 2;

// Same seed, fleet, rates, and existing commitments. These are tradeoff checks, not a
// claim that a mathematical optimum replaces first-time-player testing. Each scenario survives
// its first four years on the starting fleet, so every build-out can finish.
describe.each([106, 107, 113])(
  "customer program balance in scenario %s",
  (scenarioId) => {
    test("build-outs preserve accounting, trade cash for demand, and stop costing at completion", () => {
      const play = (efficiency: PolicyTier, solar: PolicyTier) =>
        runSimulation({
          scenarioId,
          seed: 4,
          months: MONTHS,
          initialPrograms: { efficiency, solar },
        });
      const off = play("Off", "Off");
      const efficiency = play("On", "Off");
      const solar = play("Off", "On");
      const both = play("On", "On");
      // Starting later shifts the same project: nothing is spent before it begins.
      const late = runSimulation({
        scenarioId,
        seed: 4,
        months: MONTHS,
        scheduledActions: [
          { month: 6, type: "policy", id: "efficiency", tier: "On" },
        ],
      });
      [off, efficiency, solar, both, late].forEach((result) => {
        expect(result.violations).toEqual([]);
        expect(result.outcome).not.toBe("bankrupt");
      });
      // First effective month comparisons share identical customer assumptions and horizon.
      const baseline = off.months[1];
      expect(efficiency.months[1].demandWh).toBeLessThan(baseline.demandWh);
      expect(both.months[1].demandWh).toBeLessThan(
        efficiency.months[1].demandWh,
      );
      expect(both.months[1].cash).toBeLessThan(baseline.cash);
      // Savings grow with installations and are kept after completion.
      const saving = (month: number) =>
        1 - efficiency.months[month].demandWh / off.months[month].demandWh;
      expect(saving(BUILDOUT / 2)).toBeGreaterThan(saving(1));
      expect(saving(BUILDOUT + 1)).toBeGreaterThan(saving(BUILDOUT / 2));
      [efficiency, solar, both].forEach((result) => {
        const spent = result.months.map((m) => m.expensesPolicy!);
        expect(spent.slice(1, BUILDOUT + 1).every((m) => m > 0)).toBe(true);
        expect(spent.slice(BUILDOUT + 1).every((m) => m === 0)).toBe(true);
      });
      const lateSpent = late.months.map((m) => m.expensesPolicy!);
      expect(lateSpent.slice(0, 7).every((m) => m === 0)).toBe(true);
      expect(lateSpent.slice(7).every((m) => m > 0)).toBe(true);
      expect(off.months.every((m) => m.expensesPolicy === 0)).toBe(true);
    });
  },
);

test("efficiency still pays back some demand in a mild climate", () => {
  // San Francisco barely heats or cools, so only the appliance share of savings applies.
  const play = (efficiency: PolicyTier) =>
    runSimulation({
      scenarioId: 100,
      seed: 4,
      months: MONTHS,
      initialPrograms: { efficiency },
    });
  const off = play("Off");
  const on = play("On");
  expect(on.violations).toEqual([]);
  const last = BUILDOUT + 1;
  const saving = 1 - on.months[last].demandWh / off.months[last].demandWh;
  expect(saving).toBeGreaterThan(0);
  expect(saving).toBeLessThan(POLICIES.efficiency.weatherSaving);
});
