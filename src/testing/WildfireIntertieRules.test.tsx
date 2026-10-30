import { DIFFICULTY_IDS } from "../Constants";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { getScenario } from "../data/Scenarios";
import { resolveStoryAtDate, upcomingStoryPhases } from "../data/WorldEvents";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import {
  scenarioRules,
  validCompiledScenarioRules,
} from "../helpers/ScenarioRules";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { buildStorySnapshot } from "../helpers/Story";
import {
  intertieContextForGame,
  intertieOfferLimits,
  transmissionRatingW,
} from "../helpers/Transmission";
import type { ActiveWorldEventType } from "../Types";
import { digest } from "./CanonicalHash";
import { createGame } from "./Simulator";

const scenario = getScenario(111)!;
const rulesFor = (difficulty: (typeof DIFFICULTY_IDS)[number], seed = 12345) =>
  scenarioRules(scenario, { difficulty, seed })!;

test.each(DIFFICULTY_IDS)(
  "native 111 keeps its redesigned grid, intertie phases and previews on %s",
  (difficulty) => {
    expect(SCENARIO_CHOICES.filter((item) => item.scenarioId === 111)).toEqual(
      [],
    );
    const game = createGame({ scenarioId: 111, difficulty, seed: 12345 });
    expect(game.customScenario).toBeUndefined();
    expect(pendingScenarioChoice(game)).toBeUndefined();
    const rules = rulesFor(difficulty);
    expect(validCompiledScenarioRules(rules)).toBe(true);
    expect(rules.namespace).toEqual({
      kind: "official",
      scenarioId: 111,
      arcId: "wildfire-intertie",
    });
    expect(rules.arcChoices).toEqual([]);
    expect(
      [...rules.events]
        .sort((a, b) => a.startMonth - b.startMonth)
        .map((event) => [event.id, event.startMonth, event.durationMonths]),
    ).toEqual([
      ["readiness", 25, 0],
      ["outage", 36, 2],
      ["restored", 38, 0],
    ]);
    for (const event of rules.events) {
      expect(event.targets).toEqual([]);
      expect(event.transactions).toEqual([]);
      expect(event.protection).toBeUndefined();
      expect(event.source?.drawKey).toBeUndefined();
    }
    const probe = {
      rules,
      scenarioId: 111,
      difficulty,
      seed: 12345,
      date: game.date,
      location: game.location,
      occurrences: [] as ActiveWorldEventType[],
      snapshot: buildStorySnapshot([], game.facilities, 0),
    };
    const previews = upcomingStoryPhases(probe);
    expect(previews).toHaveLength(1);
    const phases = rules.events.map((event) => {
      probe.date = getDateFromMinute(
        event.startMonth * MINUTES_PER_MONTH,
        game.startingYear,
      );
      const actual = resolveStoryAtDate(probe).occurrences.find(
        (item) => item.key === event.key,
      )!;
      probe.occurrences.push(actual);
      return actual;
    });
    expect(
      digest({
        facilities: game.facilities,
        transmission: game.transmission,
        loadAdditions: game.loadAdditions,
        phases,
        previews,
      }),
    ).toMatchSnapshot();
  },
);

test("the owning route API caps the surviving intertie in the outage and leaves independent connections alone", () => {
  const game = createGame({ scenarioId: 111, difficulty: "CEO", seed: 12345 });
  const north = game.transmission!.lines.find(
    (line) => line.corridorId === "california-north",
  )!;
  const context = intertieContextForGame(game);
  const normal = { temperatureC: 20, solarIrradianceWM2: 0 };
  const outage = {
    ...normal,
    transmissionCapacityLimitsWByCorridor: { "california-north": 4e6 },
  };
  for (const capacityW of [north.capacityW, 2 * north.capacityW, 1e9]) {
    const line = { ...north, capacityW };
    expect(transmissionRatingW(line, outage)).toBeLessThanOrEqual(4e6);
    const limits = intertieOfferLimits(
      line,
      context,
      36 * MINUTES_PER_MONTH,
      outage,
    );
    expect(limits.importLimitW).toBeLessThanOrEqual(4e6);
    expect(limits.exportLimitW).toBeLessThanOrEqual(4e6);
  }
  const south = { ...north, corridorId: "california-south", capacityW: 15e6 };
  expect(transmissionRatingW(south, outage)).toBe(
    transmissionRatingW(south, normal),
  );
  expect(
    transmissionRatingW(north, {
      ...outage,
      transmissionCapacityLimitsWByCorridor: { "california-north": 0 },
    }),
  ).toBe(0);
  expect(transmissionRatingW({ ...north, paused: true }, outage)).toBe(0);
});
