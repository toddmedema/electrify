import "../Store";
import fs from "fs";
import path from "path";
import cloneDeep from "lodash.clonedeep";
import type { DifficultyType, ScenarioType } from "../Types";
import { decodeReplay } from "../Replay";
import { parseSave } from "../SaveGame";
import { validScenarioMod, modRuntimeDigest } from "../helpers/ScenarioMod";
import {
  OFFICIAL_WORLD_IDS,
  officialWorldHash,
} from "../testing/OfficialWorldRoutes";
import { runSimulation, type SimOptionsType } from "../testing/Simulator";

interface FrozenCase {
  group: number;
  ids: number[];
  difficulty: DifficultyType;
  scenario: ScenarioType;
  options: Pick<SimOptionsType, "months" | "dollarsPerkWh" | "initialBuild">;
  monthlyHistoryHash: string;
  finalFacilitiesHash: string;
  storyOccurrences: unknown;
  outcome: string;
}
const reference: {
  baselineCommit: string;
  significantDigits: number;
  cases: FrozenCase[];
  oldEnvelopeCases: {
    group: number;
    difficulty: DifficultyType;
    save: unknown;
    replay: unknown;
  }[];
} = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../testing/fixtures/FrozenLegacyArcSnapshots.json"),
    "utf8",
  ),
);

jest.setTimeout(120000);
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("the immutable old DTO matrix covers every arc at two difficulties", () => {
  expect(reference.baselineCommit).toBe(
    "2fc5d50ebedd5d3695b9db7d75ca5b54c0912779",
  );
  expect(reference.significantDigits).toBe(10);
  expect(reference.cases).toHaveLength(10);
  for (const difficulty of ["Employee", "CEO"])
    expect(
      reference.cases
        .filter((item) => item.difficulty === difficulty)
        .flatMap((item) => item.ids)
        .sort((a, b) => a - b),
    ).toEqual([...OFFICIAL_WORLD_IDS]);
  expect(reference.oldEnvelopeCases).toHaveLength(1);
});

for (const expected of reference.cases.filter(
  (item) => !item.ids.includes(111),
))
  test(`old group ${expected.group} on ${expected.difficulty} runs its frozen rules without recompiling the package`, () => {
    const scenario = cloneDeep(expected.scenario);
    expect(validScenarioMod(scenario.mod, scenario)).toBe(true);
    expect(
      scenario.mod!.rules.officialArcs.map((arc) => arc.scenarioId),
    ).toEqual(expected.ids);
    const result = runSimulation({
      ...expected.options,
      scenarioId: 999,
      scenario,
      seed: scenario.seed,
      difficulty: expected.difficulty,
    });
    expect(result.violations).toEqual([]);
    expect(result.months).toHaveLength(2);
    expect(result.finalFacilities).toContainEqual(
      expect.objectContaining({ name: "Natural Gas Peaker", peakW: 2e8 }),
    );
    expect(result.builds).toHaveLength(1);
    expect(officialWorldHash(result.months)).toBe(expected.monthlyHistoryHash);
    expect(officialWorldHash(result.finalFacilities)).toBe(
      expected.finalFacilitiesHash,
    );
    expect(result.storyOccurrences).toEqual(expected.storyOccurrences);
    expect(result.outcome).toBe(expected.outcome);
    expect(scenario).toEqual(expected.scenario);
  });

test("retired private111 prototype DTOs and their enclosing documents are unsupported", () => {
  for (const item of reference.cases.filter((entry) =>
    entry.ids.includes(111),
  )) {
    expect(
      item.scenario.mod!.rules.arcEvents!.some(
        (event) => event.source?.arcId === "california-wildfire-2025",
      ),
    ).toBe(true);
    expect(validScenarioMod(item.scenario.mod, item.scenario)).toBe(false);
  }
  for (const source of reference.oldEnvelopeCases) {
    expect(parseSave(cloneDeep(source.save))).toBeNull();
    expect(decodeReplay(cloneDeep(source.replay))).toBeNull();
  }
});

test("valid frozen arc snapshots reject forged trusted metadata", () => {
  const original = reference.cases.find((item) => item.group === 0)!.scenario;
  expect(validScenarioMod(original.mod, original)).toBe(true);
  const edited = cloneDeep(original);
  const event = edited.mod!.rules.arcEvents!.find((event) => event.source)!;
  Object.assign(event.source!, { unexpectedTrustedField: true });
  edited.mod!.runtimeDigest = modRuntimeDigest(edited.mod!);
  expect(validScenarioMod(edited.mod, edited)).toBe(false);
  expect(validScenarioMod(original.mod, original)).toBe(true);
});
