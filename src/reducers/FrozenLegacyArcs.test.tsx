import "../Store";
import fs from "fs";
import path from "path";
import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH } from "../Constants";
import type { DifficultyType, ScenarioType } from "../Types";
import { decodeReplay } from "../Replay";
import { parseSave } from "../SaveGame";
import { getScenarioLocation } from "../helpers/Locations";
import { validScenarioMod, modRuntimeDigest } from "../helpers/ScenarioMod";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { loadSimData } from "../testing/SimData";
import {
  OFFICIAL_WORLD_IDS,
  officialWorldHash,
} from "../testing/OfficialWorldRoutes";
import {
  createGameFromReplay,
  runSimulation,
  type SimOptionsType,
} from "../testing/Simulator";
import { tickState } from "./Game";

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

for (const expected of reference.cases)
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

test("an actual old save and internal replay retain their detached imported rules", () => {
  const source = reference.oldEnvelopeCases[0];
  const expected = reference.cases.find(
    (item) =>
      item.group === source.group && item.difficulty === source.difficulty,
  )!;
  loadSimData(getScenarioLocation(expected.scenario)!);
  const saved = parseSave(cloneDeep(source.save));
  const replay = decodeReplay(cloneDeep(source.replay));
  expect(saved).not.toBeNull();
  expect(replay).not.toBeNull();
  expect(saved!.game.customScenario).toEqual(expected.scenario);
  expect(replay!.customScenario).toEqual(expected.scenario);
  const resumed = cloneDeep(saved!.game);
  const playback = createGameFromReplay(replay!);
  for (let tick = 0; tick < 2 * TICKS_PER_MONTH; tick++) {
    expect(pendingScenarioChoice(resumed)).toBeUndefined();
    expect(pendingScenarioChoice(playback)).toBeUndefined();
    tickState(resumed);
    tickState(playback);
  }
  expect(resumed.monthlyHistory).toHaveLength(2);
  expect(playback.monthlyHistory).toEqual(resumed.monthlyHistory);
  // The old JSON save stores nonfinite quote-only lcWh as null. Fresh replay quotes
  // retain Infinity. Certify those two known cells, then compare every other field.
  let quoteOnlyNulls = 0;
  const serializedQuotes = playback.facilities.map((facility, index) => {
    if (resumed.facilities[index].lcWh !== null) return facility;
    expect(["Wind", "Sun"]).toContain(facility.fuel);
    expect(facility.lcWh).toBe(Infinity);
    quoteOnlyNulls++;
    return { ...facility, lcWh: null };
  });
  expect(quoteOnlyNulls).toBe(2);
  expect(serializedQuotes).toEqual(resumed.facilities);
  expect(playback.worldEvents).toEqual(resumed.worldEvents);
  expect(resumed.customScenario).toEqual(expected.scenario);
  expect(playback.customScenario).toEqual(expected.scenario);
});

test("frozen legacy arc compatibility still rejects newly forged trusted metadata", () => {
  const original = reference.cases.find((item) => item.group === 1)!.scenario;
  expect(validScenarioMod(original.mod, original)).toBe(true);
  const edited = cloneDeep(original);
  const event = edited.mod!.rules.arcEvents!.find((event) => event.source)!;
  Object.assign(event.source!, { unexpectedTrustedField: true });
  edited.mod!.runtimeDigest = modRuntimeDigest(edited.mod!);
  expect(validScenarioMod(edited.mod, edited)).toBe(false);
  expect(validScenarioMod(original.mod, original)).toBe(true);
});
