import { SCENARIOS } from "./Scenarios";
import { scenarioRules } from "../helpers/ScenarioRules";
import { getDateFromMinute } from "../helpers/DateTime";

// Pin historical headline dates while checking the actual engine schedule, including seeded arcs.
const HEADLINERS: Record<
  number,
  { year: number; month: number; lastMonth?: number; phase?: string }
> = {
  100: { year: 2020, month: 48, phase: "ratchet-onset" },
  101: { year: 2002, month: 84, phase: "procurement-step" },
  102: { year: 1980, month: 72, phase: "aging-derate" },
  103: { year: 2006, month: 48, phase: "regional-glut" },
  104: { year: 2000, month: 101, lastMonth: 106, phase: "landfall" },
  105: { year: 2004, month: 28, phase: "visitor-peak" },
  106: { year: 2020, month: 72 },
  107: { year: 2017, month: 49, phase: "uri" },
  108: { year: 2024, month: 29, phase: "heatwave-month-1" },
  110: { year: 2024, month: 30, lastMonth: 36, phase: "trip" },
  111: { year: 2024, month: 12, phase: "outage" },
  113: { year: 2018, month: 12, phase: "availability-step-1" },
  114: { year: 2014, month: 12, phase: "reservoir-step-1" },
  115: { year: 2021, month: 4, phase: "summer-peak-1" },
};

test.each(SCENARIOS.filter((scenario) => !scenario.tutorialSteps))(
  "$name opens in January at least 36 months before its headline event",
  (scenario) => {
    const headline = HEADLINERS[scenario.id];
    expect(headline).toBeDefined();
    const date = getDateFromMinute(0, scenario.startingYear);
    expect(date.monthNumber).toBe(1);
    const leadMonths = [1, 2468, 9981].map((seed) => {
      if (!headline.phase) {
        const load = scenario.loadAdditions![0];
        return (
          (load.startsYear - scenario.startingYear) * 12 +
          (load.startsMonth ?? 1) -
          1
        );
      }
      const rules = scenarioRules(scenario, { difficulty: "Manager", seed })!;
      const event = rules.events.find((item) => item.id === headline.phase)!;
      expect(event).toBeDefined();
      return event.startMonth;
    });
    for (const lead of leadMonths) {
      expect(lead).toBeGreaterThanOrEqual(36);
      expect(lead).toBeLessThan(scenario.durationMonths);
      const calendarMonth = scenario.startingYear * 12 + lead;
      expect(calendarMonth).toBeGreaterThanOrEqual(
        headline.year * 12 + headline.month,
      );
      expect(calendarMonth).toBeLessThanOrEqual(
        headline.year * 12 + (headline.lastMonth ?? headline.month),
      );
    }
  },
);
