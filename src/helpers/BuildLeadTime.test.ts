import { getScenario } from "../data/Scenarios";
import { scenarioRules } from "./ScenarioRules";
import {
  buildLeadTimeHint,
  naturalGasYearsToBuild,
  referenceBuildMonths,
} from "./BuildLeadTime";

function leadMonths(scenarioId: number, warning: string, event: string) {
  const rules = scenarioRules(getScenario(scenarioId), {
    difficulty: "CEO",
    seed: 12345,
  })!;
  const phase = (id: string) => rules.events.find((item) => item.id === id)!;
  return (
    phase(event).possibleStartMonths.from -
    phase(warning).possibleStartMonths.from
  );
}

describe("build lead times", () => {
  it("scale the catalog formulas by difficulty", () => {
    expect(naturalGasYearsToBuild(1_000_000)).toBeCloseTo(2.46, 10);
    expect(referenceBuildMonths("CEO").gas).toBe(40);
    expect(referenceBuildMonths("Intern").gas).toBeLessThan(
      referenceBuildMonths("CEO").gas,
    );
    expect(buildLeadTimeHint("CEO")).toMatch(/about 40 months/);
  });

  it("give each in-game warning time to build a response at CEO", () => {
    const { gas, battery } = referenceBuildMonths("CEO");
    // The hurricane warning leaves time for a new gas plant before the earliest landfall
    expect(leadMonths(104, "outlook", "landfall")).toBeGreaterThanOrEqual(gas);
    // The short scenarios leave time for storage at least
    expect(
      leadMonths(108, "seasonal-warning", "heatwave-month-1"),
    ).toBeGreaterThanOrEqual(battery);
    expect(
      leadMonths(110, "contingency-review", "trip"),
    ).toBeGreaterThanOrEqual(battery);
  });
});
