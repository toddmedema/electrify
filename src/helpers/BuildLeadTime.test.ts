import { STORY_ARC_DEFINITIONS, StoryScheduleType } from "../data/WorldEvents";
import {
  buildLeadTimeHint,
  naturalGasYearsToBuild,
  referenceBuildMonths,
} from "./BuildLeadTime";

const firstMonth = (schedule: StoryScheduleType) =>
  "atMonth" in schedule
    ? schedule.atMonth
    : schedule.seededMonthRange.firstMonth;

function leadMonths(scenarioId: number, warning: string, event: string) {
  const arc = STORY_ARC_DEFINITIONS.find((a) => a.scenarioId === scenarioId)!;
  const phase = (id: string) => arc.phases.find((p) => p.id === id)!;
  return (
    firstMonth(phase(event).schedule) - firstMonth(phase(warning).schedule)
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
