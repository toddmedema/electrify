import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { DIFFICULTY_IDS } from "../Constants";
import { SCENARIOS, getScenario } from "../data/Scenarios";
import type { CompiledScenarioRules } from "../data/ScenarioRules";
import {
  resolveStoryAtDate,
  upcomingStoryPhases,
  type StoryContextType,
} from "../data/WorldEvents";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { scenarioRules } from "../helpers/ScenarioRules";
import { buildStorySnapshot } from "../helpers/Story";
import type {
  ActiveWorldEventType,
  DifficultyType,
  GameType,
  StorySnapshotType,
} from "../Types";
import { createGame } from "./Simulator";

interface LegacyPhase {
  hash: string;
  key: string;
  startsMinute: number;
  endsMinute: number;
  originalUnavailable?: ActiveWorldEventType;
}
interface LegacyCase {
  scenarioId: number;
  difficulty: DifficultyType;
  seed: number;
  optionId?: string;
  profile: "strong" | "weak" | "unavailable";
  hash: string;
  phases: number[];
  previews: number[];
}
interface LegacyChoiceContext {
  scenarioId: number;
  difficulty: DifficultyType;
  id: string;
  title: string;
  options: string[];
}
const reference: {
  provenance: { sourceSHA256: string; significantDigits: number };
  seedCoverage: Record<string, Record<string, number>>;
  unavailableReviewKeys: string[];
  setups: { scenarioId: number; difficulty: DifficultyType; hash: string }[];
  choiceContexts: LegacyChoiceContext[];
  cases: LegacyCase[];
  phaseFacts: LegacyPhase[];
} = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/OfficialScenarioLegacyPhases.json"),
    "utf8",
  ),
);

jest.setTimeout(120000);
const scenarioIds = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115,
];

/** Same ten-significant-digit, sorted-key canonicalization as the original independent capture. */
function canonical(value: unknown): unknown {
  if (typeof value === "number")
    return Number.isFinite(value)
      ? Number(value.toPrecision(10))
      : String(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const grids = new Map<string, GameType>();
function originalGrid(
  scenarioId: number,
  difficulty: DifficultyType,
): GameType {
  const key = `${scenarioId}:${difficulty}`;
  let grid = grids.get(key);
  if (!grid) {
    grid = createGame({ scenarioId, difficulty, seed: 12345 });
    grids.set(key, grid);
  }
  return grid;
}

type Sample = Pick<
  StorySnapshotType,
  | "demandWh12m"
  | "unservedWh12m"
  | "netIncome12m"
  | "peakDemandW12m"
  | "firmPeakW"
  | "storagePeakW"
  | "storagePeakWh"
  | "deliveredWhByFuel12m"
>;
function sample(profile: LegacyCase["profile"]): Sample | undefined {
  if (profile === "unavailable") return undefined;
  return profile === "strong"
    ? {
        demandWh12m: 1e12,
        unservedWh12m: 0,
        netIncome12m: 1e6,
        peakDemandW12m: 1e9,
        firmPeakW: 1.1e9,
        storagePeakW: 2e8,
        storagePeakWh: 8e8,
        deliveredWhByFuel12m: {
          Coal: 1e11,
          "Natural Gas": 2e11,
          Wind: 3e11,
          Sun: 2e11,
          Hydro: 2e11,
        },
      }
    : {
        demandWh12m: 1e12,
        unservedWh12m: 5e10,
        netIncome12m: -1e6,
        peakDemandW12m: 1e9,
        firmPeakW: 3e8,
        storagePeakW: 1e7,
        storagePeakWh: 2e7,
        deliveredWhByFuel12m: {
          Coal: 7e11,
          "Natural Gas": 2e11,
          Wind: 2e10,
          Sun: 1e10,
          Hydro: 2e10,
        },
      };
}
function probeFor(
  expected: LegacyCase,
  game: GameType,
  rules: CompiledScenarioRules,
): StoryContextType {
  const measured = sample(expected.profile);
  const choice = reference.choiceContexts.find(
    (item) =>
      item.scenarioId === expected.scenarioId &&
      item.difficulty === expected.difficulty,
  );
  const occurrences: ActiveWorldEventType[] =
    choice && expected.optionId
      ? [
          {
            key: choice.id,
            definitionId: choice.id,
            startsMinute: 0,
            endsMinute: 0,
            title: choice.title,
            message: "Recorded answer",
            effects: {},
            attributes: { choice: expected.optionId },
          },
        ]
      : [];
  return {
    rules,
    seed: expected.seed,
    scenarioId: expected.scenarioId,
    difficulty: expected.difficulty,
    date: game.date,
    location: game.location,
    occurrences,
    snapshot: { ...buildStorySnapshot([], game.facilities, 0), ...measured },
    ...(measured
      ? {
          periodSnapshots: Object.fromEntries(
            [1, 2, 3, 4, 6, 12, 24].map((months) => [
              months,
              {
                deliveredWhByFuel: measured.deliveredWhByFuel12m,
                demandWh: measured.demandWh12m,
                unservedWh: measured.unservedWh12m,
                netIncome: measured.netIncome12m,
                peakDemandW: measured.peakDemandW12m,
              },
            ]),
          ),
        }
      : {}),
  };
}
function at(
  probe: StoryContextType,
  game: GameType,
  minute: number,
  profile: LegacyCase["profile"],
): StoryContextType {
  return {
    ...probe,
    date: getDateFromMinute(minute, game.startingYear),
    snapshot: {
      ...buildStorySnapshot([], game.facilities, minute),
      ...sample(profile),
    },
  };
}

/** Exactly six old zero-demand report cases deliberately stop claiming a fabricated 100%. */
function expectLegacyPhase(
  actual: ActiveWorldEventType,
  expected: LegacyPhase,
  profile: LegacyCase["profile"],
  preview = false,
) {
  expect(actual).toBeDefined();
  const unavailable =
    profile === "unavailable" &&
    reference.unavailableReviewKeys.includes(expected.key);
  if (!unavailable) {
    expect({ key: actual.key, hash: digest(actual) }).toEqual({
      key: expected.key,
      hash: expected.hash,
    });
    return;
  }
  const original = expected.originalUnavailable!;
  expect(original).toBeDefined();
  const {
    attributes: _oldAttributes,
    importance: _oldImportance,
    message: oldMessage,
    ...stableOriginal
  } = original;
  const { attributes, importance, message, ...stableActual } = actual;
  expect(canonical(stableActual)).toEqual(canonical(stableOriginal));
  expect(attributes).toEqual({
    scheduledMonth: original.attributes.scheduledMonth,
    reportAvailable: false,
  });
  expect(importance).toBe("ROUTINE");
  expect(message).toBe(
    preview
      ? oldMessage
      : "Report unavailable. No completed electricity demand is recorded for this review.",
  );
}

function expectBeforeOnset(
  probe: StoryContextType,
  game: GameType,
  phase: LegacyPhase,
  profile: LegacyCase["profile"],
) {
  if (phase.startsMinute === 0) return;
  expect(
    resolveStoryAtDate(
      at(probe, game, phase.startsMinute - 1, profile),
    ).occurrences.some((event) => event.key === phase.key),
  ).toBe(false);
}
function expectExpiry(
  probe: StoryContextType,
  game: GameType,
  rules: CompiledScenarioRules,
  phase: LegacyPhase,
  profile: LegacyCase["profile"],
) {
  const end = Math.min(
    phase.endsMinute,
    rules.durationMonths * MINUTES_PER_MONTH,
  );
  if (end <= phase.startsMinute) return;
  expect(
    resolveStoryAtDate(at(probe, game, end - 1, profile)).active.some(
      (event) => event.key === phase.key,
    ),
  ).toBe(true);
  expect(
    resolveStoryAtDate(at(probe, game, end, profile)).active.some(
      (event) => event.key === phase.key,
    ),
  ).toBe(false);
}
function expectCompleteObservedCase(
  expected: LegacyCase,
  phases: ActiveWorldEventType[],
  previews: ActiveWorldEventType[],
) {
  if (expected.profile === "unavailable") return;
  expect(digest({ expected: phases, previews })).toBe(expected.hash);
}

beforeAll(() => {
  expect(reference.provenance).toMatchObject({
    significantDigits: 10,
    sourceSHA256:
      "b9b6c268db6dde40efcb61195c0ad0c5e9a729ec5128dec82487bd64da25328b",
  });
  expect(
    SCENARIOS.filter((s) => !s.tutorialSteps)
      .map((s) => s.id)
      .sort((a, b) => a - b),
  ).toEqual(scenarioIds);
  expect(reference.setups).toHaveLength(70);
  expect(reference.cases).toHaveLength(450);
  expect(
    reference.cases.reduce((sum, item) => sum + item.phases.length, 0),
  ).toBe(1410);
  expect(
    reference.cases.reduce((sum, item) => sum + item.previews.length, 0),
  ).toBe(795);
  expect(reference.phaseFacts).toHaveLength(571);
  for (const scenarioId of scenarioIds) {
    expect(
      reference.setups
        .filter((s) => s.scenarioId === scenarioId)
        .map((s) => s.difficulty)
        .sort(),
    ).toEqual([...DIFFICULTY_IDS].sort());
    for (const difficulty of DIFFICULTY_IDS) {
      const matching = reference.cases.filter(
        (item) =>
          item.scenarioId === scenarioId && item.difficulty === difficulty,
      );
      expect([...new Set(matching.map((item) => item.profile))].sort()).toEqual(
        ["strong", "unavailable", "weak"],
      );
      const choice = reference.choiceContexts.find(
        (item) =>
          item.scenarioId === scenarioId && item.difficulty === difficulty,
      );
      expect(
        [...new Set(matching.map((item) => item.optionId))].sort(),
      ).toEqual((choice ? [...choice.options] : [undefined]).sort());
    }
  }
});

for (const scenarioId of scenarioIds) {
  test(`official ${scenarioId} retains every old starting grid, phase, preview and observed branch`, () => {
    for (const expected of reference.setups.filter(
      (item) => item.scenarioId === scenarioId,
    )) {
      const game = originalGrid(scenarioId, expected.difficulty);
      expect(game.customScenario).toBeUndefined();
      expect(
        digest({
          scenarioId,
          difficulty: expected.difficulty,
          startingYear: game.startingYear,
          location: game.location,
          facilities: game.facilities,
          loadAdditions: game.loadAdditions,
        }),
      ).toBe(expected.hash);
    }
    for (const expected of reference.cases.filter(
      (item) => item.scenarioId === scenarioId,
    )) {
      const game = originalGrid(scenarioId, expected.difficulty);
      const rules = scenarioRules(getScenario(scenarioId), expected)!;
      expect(rules).toBeDefined();
      expect(rules.namespace).toMatchObject({ kind: "official", scenarioId });
      expect(rules.difficulty).toBe(expected.difficulty);
      expect(rules.seed).toBe(expected.seed);
      const probe = probeFor(expected, game, rules);
      const actualPhases: ActiveWorldEventType[] = [];
      const expectedFacts = expected.phases.map(
        (index) => reference.phaseFacts[index],
      );
      expect(rules.events.map((event) => event.key).sort()).toEqual(
        expectedFacts.map((phase) => phase.key).sort(),
      );
      for (const phase of expectedFacts) {
        const definition = rules.events.find(
          (event) => event.key === phase.key,
        )!;
        expect(definition.startMonth * MINUTES_PER_MONTH).toBe(
          phase.startsMinute,
        );
        const onset = at(probe, game, phase.startsMinute, expected.profile);
        const actual = resolveStoryAtDate(onset).occurrences.find(
          (event) => event.key === phase.key,
        )!;
        expectLegacyPhase(actual, phase, expected.profile);
        actualPhases.push(actual);
        probe.occurrences!.push(actual);
        probe.date = onset.date;
        probe.snapshot = onset.snapshot;
        expectBeforeOnset(probe, game, phase, expected.profile);
        expectExpiry(probe, game, rules, phase, expected.profile);
      }
      const previews = upcomingStoryPhases({
        ...probe,
        date: getDateFromMinute(0, game.startingYear),
        occurrences: [],
      });
      expect(previews.map((event) => event.key)).toEqual(
        expected.previews.map((index) => reference.phaseFacts[index].key),
      );
      for (const [index, actual] of previews.entries())
        expectLegacyPhase(
          actual,
          reference.phaseFacts[expected.previews[index]],
          expected.profile,
          true,
        );
      expectCompleteObservedCase(expected, actualPhases, previews);
    }
  });
}

test("the legacy fixtures reach every hidden nuclear and hurricane onset at all five difficulties", () => {
  for (const [key, oldDraws] of Object.entries(reference.seedCoverage)) {
    const scenarioId = Number(key.split(":")[1]);
    const expectedMonths = Object.keys(oldDraws)
      .map(Number)
      .sort((a, b) => a - b);
    expect(expectedMonths).toEqual(
      scenarioId === 104
        ? [101, 102, 103, 104, 105, 106]
        : [30, 31, 32, 33, 34, 35, 36],
    );
    for (const difficulty of DIFFICULTY_IDS)
      for (const [originalMonth, seed] of Object.entries(oldDraws)) {
        const rules = scenarioRules(getScenario(scenarioId), {
          difficulty,
          seed,
        })!;
        const phase = rules.events.find((event) => event.key === key)!;
        expect(phase.startMonth).toBe(
          Number(originalMonth) + (scenarioId === 110 ? 12 : 0),
        );
      }
  }
});

test("the native coal derate preserves its independent target effects without warning presentation", () => {
  const expected = reference.cases.find(
    (item) =>
      item.scenarioId === 102 &&
      item.difficulty === "CEO" &&
      item.seed === 12345 &&
      item.profile === "strong",
  )!;
  const game = originalGrid(102, "CEO");
  const rules = scenarioRules(getScenario(102), expected)!;
  const phase = expected.phases
    .map((index) => reference.phaseFacts[index])
    .find((item) => item.key.endsWith(":aging-derate"))!;
  const probe = at(
    probeFor(expected, game, rules),
    game,
    phase.startsMinute,
    expected.profile,
  );
  const actual = resolveStoryAtDate(probe).occurrences.find(
    (item) => item.key === phase.key,
  )!;
  // Copied from the independent old CEO phase: only the original older coal plant is derated.
  expect(actual.effects.facilityOutputMultipliersById).toEqual({ "1": 0.8 });
  expectLegacyPhase(actual, phase, expected.profile);
});
