import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { DIFFICULTY_IDS } from "../Constants";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { getScenario } from "../data/Scenarios";
import type { CompiledScenarioRules } from "../data/ScenarioRules";
import type { ObjectiveContext } from "../data/ScenarioObjectives";
import {
  resolveStoryAtDate,
  upcomingStoryPhases,
  type StoryContextType,
} from "../data/WorldEvents";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import {
  scenarioRules,
  validCompiledScenarioRules,
} from "../helpers/ScenarioRules";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { scenarioObjectiveFailure } from "../helpers/ObjectiveRules";
import { ruleDigest } from "../helpers/RuleIdentity";
import {
  createObjectiveProgress,
  recordObjectiveMonth,
  evaluateScenarioObjectives,
} from "../helpers/ScenarioObjectives";
import { buildStorySnapshot } from "../helpers/Story";
import {
  intertieContextForGame,
  intertieOfferLimits,
  transmissionRatingW,
} from "../helpers/Transmission";
import type {
  ActiveWorldEventType,
  DifficultyType,
  GameType,
  MonthlyHistoryType,
  StorySnapshotType,
} from "../Types";
import { createGame } from "./Simulator";
import { projectUpstreamWildfireFacilities } from "./UpstreamWildfireComparison";

interface PhaseCase {
  scenarioId: number;
  difficulty: DifficultyType;
  seed: number;
  profile: "strong" | "weak" | "unavailable";
  phases: number[];
  previews: number[];
  boundaryFacts: number[];
  choices: unknown[];
  hash: string;
}
interface CapturedCampaign {
  options: { difficulty: DifficultyType; seed: number };
  actualOutcome: "completed" | "fired";
  actualTerminalMonth: number;
  actualFailure?: { reason: string };
  objective: {
    verdict: string | null;
    reliabilityFailure: string | null;
    observedMonths: MonthlyHistoryType[];
  };
  reachedCaps: {
    upgrades: {
      capacityW: number;
      ratingW: number;
      limits: ReturnType<typeof intertieOfferLimits>;
    }[];
    independentSouthRatingW: number;
    independentSouthNormalRatingW: number;
  };
}
const reference: {
  provenance: {
    sourceCommit: string;
    sourceSHA256: string;
    sourceBytes: number;
    significantDigits: number;
  };
  setups: {
    scenarioId: number;
    difficulty: DifficultyType;
    seed: number;
    hash: string;
    value: unknown;
  }[];
  cases: PhaseCase[];
  facts: { hash: string; value: ActiveWorldEventType | { month: number } }[];
  campaigns: CapturedCampaign[];
  failureNeighbors: CapturedCampaign[];
} = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/UpstreamWildfireReference.json"),
    "utf8",
  ),
);

function canonical(value: unknown): unknown {
  if (typeof value === "number")
    return Number.isFinite(value)
      ? Number(value.toPrecision(10))
      : String(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const grids = new Map<string, GameType>();
const setup = (difficulty: DifficultyType, seed: number) => {
  const key = `${difficulty}:${seed}`;
  let game = grids.get(key);
  if (!game) {
    game = createGame({ scenarioId: 111, difficulty, seed });
    grids.set(key, game);
  }
  return game;
};
const rulesFor = (difficulty: DifficultyType, seed: number) =>
  scenarioRules(getScenario(111), { difficulty, seed })!;
const expectedPhase = (index: number) => {
  const fact = reference.facts[index].value;
  if (!("key" in fact))
    throw new Error("The locked phase fixture points at a boundary fact");
  return fact;
};
function context(
  expected: PhaseCase,
  game: GameType,
  rules: CompiledScenarioRules,
): StoryContextType {
  const sample: Partial<StorySnapshotType> =
    expected.profile === "strong"
      ? { demandWh12m: 1e12, unservedWh12m: 0, netIncome12m: 1e6 }
      : expected.profile === "weak"
        ? { demandWh12m: 1e12, unservedWh12m: 5e10, netIncome12m: -1e6 }
        : {};
  return {
    rules,
    scenarioId: 111,
    difficulty: expected.difficulty,
    seed: expected.seed,
    date: game.date,
    location: game.location,
    occurrences: [],
    snapshot: { ...buildStorySnapshot([], game.facilities, 0), ...sample },
  };
}
function objectiveResults(
  campaign: CapturedCampaign,
  history = campaign.objective.observedMonths,
) {
  const scenario = getScenario(111)!;
  const rules = rulesFor(campaign.options.difficulty, campaign.options.seed);
  const context: ObjectiveContext = {
    rulesDigest: ruleDigest(rules.objectives),
    seed: campaign.options.seed,
    startingYear: scenario.startingYear,
    durationMonths: scenario.durationMonths,
    ownership: scenario.ownership,
    completedMonths: campaign.actualTerminalMonth,
  };
  let progress = createObjectiveProgress(
    rules.objectives,
    context,
    scenario.startingCustomers!,
  );
  for (const row of [...history].sort(
    (a, b) => a.year - b.year || a.month - b.month,
  ))
    progress = recordObjectiveMonth(
      progress,
      rules.objectives,
      {
        month: (row.year - scenario.startingYear) * 12 + row.month - 1,
        history: row,
      },
      context,
    );
  return evaluateScenarioObjectives(rules.objectives, progress, context);
}

beforeAll(() => {
  expect(reference.provenance).toMatchObject({
    sourceCommit: "b4afcd80c173934650a71e0e7586e8732d1b233e",
    sourceSHA256:
      "786ad0027ac6c793fb74fdc62a43787e8128d523822726529fdcbab5751bec33",
    sourceBytes: 5430809,
    significantDigits: 10,
  });
  expect(reference.setups).toHaveLength(10);
  expect(reference.cases).toHaveLength(30);
  expect(
    reference.cases.reduce((total, item) => total + item.phases.length, 0),
  ).toBe(90);
  expect(
    reference.cases.reduce((total, item) => total + item.previews.length, 0),
  ).toBe(30);
  expect(reference.facts).toHaveLength(19);
  expect(reference.campaigns).toHaveLength(10);
  expect(reference.failureNeighbors).toHaveLength(2);
  expect(SCENARIO_CHOICES.filter((item) => item.scenarioId === 111)).toEqual(
    [],
  );
});

test.each(DIFFICULTY_IDS)(
  "upstream 111 retains its entire starting grid, all phases and every preview on %s",
  (difficulty) => {
    for (const expected of reference.setups.filter(
      (item) => item.difficulty === difficulty,
    )) {
      const game = setup(difficulty, expected.seed);
      expect(game.customScenario).toBeUndefined();
      expect(pendingScenarioChoice(game)).toBeUndefined();
      const actualSetup = {
        scenarioId: 111,
        difficulty,
        seed: expected.seed,
        startingYear: game.startingYear,
        location: game.location,
        facilities: projectUpstreamWildfireFacilities(game.facilities),
        transmission: game.transmission,
        loadAdditions: game.loadAdditions,
        objective: getScenario(111)!.reliabilityObjective,
        choices: [],
      };
      expect(canonical(actualSetup)).toEqual(expected.value);
      expect(digest(actualSetup)).toBe(expected.hash);
      const rules = rulesFor(difficulty, expected.seed);
      expect(validCompiledScenarioRules(rules)).toBe(true);
      expect(rules.namespace).toEqual({
        kind: "official",
        scenarioId: 111,
        arcId: "wildfire-intertie",
      });
      expect(rules.seed).toBe(expected.seed);
      expect(rules.difficulty).toBe(difficulty);
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
    }
    for (const expected of reference.cases.filter(
      (item) => item.difficulty === difficulty,
    )) {
      const game = setup(difficulty, expected.seed);
      const rules = rulesFor(difficulty, expected.seed);
      const probe = context(expected, game, rules);
      const phases = expected.phases.map((index) => {
        const old = expectedPhase(index);
        probe.date = getDateFromMinute(old.startsMinute, game.startingYear);
        const actual = resolveStoryAtDate(probe).occurrences.find(
          (item) => item.key === old.key,
        )!;
        expect(digest(actual)).toBe(reference.facts[index].hash);
        probe.occurrences!.push(actual);
        return actual;
      });
      const previews = upcomingStoryPhases({
        ...probe,
        date: getDateFromMinute(0, game.startingYear),
        occurrences: [],
      });
      expect(previews).toHaveLength(1);
      previews.forEach((preview, index) =>
        expect(digest(preview)).toBe(
          reference.facts[expected.previews[index]].hash,
        ),
      );
      const boundaryFacts = expected.boundaryFacts.map((index) => {
        const old = reference.facts[index].value;
        if (!("month" in old))
          throw new Error("The locked boundary fixture points at a phase fact");
        const result = resolveStoryAtDate({
          ...probe,
          date: getDateFromMinute(
            old.month * MINUTES_PER_MONTH,
            game.startingYear,
          ),
          occurrences: [],
        });
        const actual = {
          month: old.month,
          occurrences: result.occurrences,
          active: result.active,
          effects: result.effects,
        };
        expect(digest(actual)).toBe(reference.facts[index].hash);
        return actual;
      });
      expect(digest({ phases, previews, boundaryFacts })).toBe(expected.hash);
    }
  },
);

test("upstream 111 goals consume the independently captured completed demand, with empty evidence unavailable", () => {
  for (const campaign of reference.campaigns) {
    const results = objectiveResults(campaign);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      metric: "monthlyReliability",
      status: "completed",
      target: 0.995,
      observedMonths: 2,
      requiredMonths: 2,
    });
    expect(
      scenarioObjectiveFailure(
        getScenario(111)!,
        campaign.objective.observedMonths,
      ) ?? null,
    ).toBe(campaign.objective.verdict);
    expect(objectiveResults(campaign, [])[0].status).toBe("unverifiable");
  }
  for (const campaign of reference.failureNeighbors) {
    expect(objectiveResults(campaign)[0]).toMatchObject({
      status: "failed",
      target: 0.995,
      observedMonths: 1,
    });
    expect(
      scenarioObjectiveFailure(
        getScenario(111)!,
        campaign.objective.observedMonths,
      ),
    ).toBe(campaign.actualFailure!.reason);
  }
});

test("the owning route API preserves upstream import/export caps, upgrade boundaries and independent connections", () => {
  for (const campaign of reference.campaigns) {
    const game = setup(campaign.options.difficulty, campaign.options.seed);
    const north = game.transmission!.lines.find(
      (line) => line.corridorId === "california-north",
    )!;
    const context = intertieContextForGame(game);
    const minute = 36 * MINUTES_PER_MONTH;
    const normal = { temperatureC: 20, solarIrradianceWM2: 0 };
    const outage = {
      ...normal,
      transmissionCapacityLimitsWByCorridor: { "california-north": 4e6 },
    };
    for (const expected of campaign.reachedCaps.upgrades) {
      const line = { ...north, capacityW: expected.capacityW };
      expect(transmissionRatingW(line, outage)).toBe(expected.ratingW);
      expect(
        canonical(intertieOfferLimits(line, context, minute, outage)),
      ).toEqual(expected.limits);
    }
    const south = { ...north, corridorId: "california-south", capacityW: 15e6 };
    expect(transmissionRatingW(south, outage)).toBe(
      campaign.reachedCaps.independentSouthRatingW,
    );
    expect(transmissionRatingW(south, normal)).toBe(
      campaign.reachedCaps.independentSouthNormalRatingW,
    );
    expect(
      transmissionRatingW(north, {
        ...outage,
        transmissionCapacityLimitsWByCorridor: { "california-north": 0 },
      }),
    ).toBe(0);
    expect(transmissionRatingW({ ...north, paused: true }, outage)).toBe(0);
  }
});
