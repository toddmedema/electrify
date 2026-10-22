import "../Store";
import fs from "fs";
import path from "path";
import cloneDeep from "lodash.clonedeep";
import { parseSave } from "../SaveGame";
import { getScenarioLocation } from "../helpers/Locations";
import {
  OFFICIAL_WORLD_IDS,
  canonicalOfficialWorld,
  officialWorldHash,
} from "./OfficialWorldRoutes";
import { loadSimData } from "./SimData";
import {
  createGame,
  runSimulation,
  type SimOptionsType,
  type SimResultType,
} from "./Simulator";

interface LegacyCustomCase {
  id: string;
  options: SimOptionsType;
  initialGameHash: string;
  monthlyHistoryHash: string;
  finalFacilitiesHash: string;
  summary: unknown;
  storyOccurrences: SimResultType["storyOccurrences"];
  oldInitialSave?: unknown;
}
const upstream: {
  baselineCommit: string;
  significantDigits: number;
  custom: LegacyCustomCase[];
} = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/UpstreamWildfireWorldCustomReference.json"),
    "utf8",
  ),
);
const reference = { ...upstream, cases: upstream.custom };
const previous: { baselineCommit: string; cases: LegacyCustomCase[] } =
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "fixtures/OrdinaryCustomLegacyReference.json"),
      "utf8",
    ),
  );

jest.setTimeout(120000);
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("the independent ordinary custom matrix covers mixed arcs and real target neighbors", () => {
  expect(reference.baselineCommit).toBe(
    "b4afcd80c173934650a71e0e7586e8732d1b233e",
  );
  expect(previous.baselineCommit).toBe(
    "2fc5d50ebedd5d3695b9db7d75ca5b54c0912779",
  );
  expect(previous.cases).toHaveLength(7);
  expect(reference.significantDigits).toBe(10);
  expect(reference.cases.map((item) => item.id)).toEqual([
    "all13-Employee",
    "all13-CEO",
    "nuclear-largest-operating",
    "nuclear-paused-largest",
    "nuclear-no-reactor",
  ]);
  for (const item of reference.cases) {
    expect(item.options.scenario!.mod).toBeUndefined();
    expect(item.options.scenario!.rules).toBeUndefined();
  }
  expect(
    reference.cases
      .filter((item) => item.id.startsWith("all13-"))
      .map((item) => item.options.scenario!.eventScenarioIds),
  ).toEqual([
    OFFICIAL_WORLD_IDS.filter((id) => id !== 111),
    OFFICIAL_WORLD_IDS.filter((id) => id !== 111),
  ]);
  expect(reference.cases.filter((item) => item.oldInitialSave)).toHaveLength(1);
});

for (const expected of reference.cases)
  test(`ordinary custom ${expected.id} preserves the complete old game and full-term simulation`, () => {
    const options = cloneDeep(expected.options);
    const game = createGame(options);
    expect(game.customScenario!.mod).toBeUndefined();
    expect(game.customScenario!.rules).toBeUndefined();
    expect(officialWorldHash(game)).toBe(expected.initialGameHash);
    const result = runSimulation(options);
    expect(result.violations).toEqual([]);
    expect(result.outcome).toBe("completed");
    expect(result.months).toHaveLength(options.scenario!.durationMonths);
    // The pre-#605 upstream simulator had no objectiveResults API; ordinary
    // custom games have no declared goals in either representation.
    expect(result.objectiveResults).toEqual([]);
    expect(officialWorldHash(result.months)).toBe(expected.monthlyHistoryHash);
    expect(officialWorldHash(result.finalFacilities)).toBe(
      expected.finalFacilitiesHash,
    );
    expect(
      canonicalOfficialWorld({
        months: result.months.length,
        outcome: result.outcome,
        finalCash: result.finalCash,
        finalDebt: result.finalDebt,
        finalNetWorth: result.finalNetWorth,
        firedAtMonth: result.firedAtMonth,
        bankruptAtMonth: result.bankruptAtMonth,
        finalTransmissionLines: result.finalTransmissionLines,
      }),
    ).toEqual(expected.summary);
    expect(canonicalOfficialWorld(result.storyOccurrences)).toEqual(
      expected.storyOccurrences,
    );
  });

for (const [id, selected] of [
  ["nuclear-largest-operating", [3]],
  ["nuclear-paused-largest", [2]],
  ["nuclear-no-reactor", []],
] as const)
  test(`the immutable ${id} route actually reaches its target neighbor`, () => {
    const expected = reference.cases.find((item) => item.id === id)!;
    const trip = expected.storyOccurrences.find(
      (item) => item.key === "story:110:nuclear-trip:trip",
    );
    expect(trip).toBeDefined();
    expect(trip!.attributes.selectedFacilityIds).toEqual(selected);
  });

test("an actual old ordinary custom save remains valid without accepting stored native rules", () => {
  const original = reference.cases.find((item) => item.oldInitialSave)!;
  expect(original.oldInitialSave).toMatchObject({ schemaVersion: 5 });
  loadSimData(getScenarioLocation(original.options.scenario)!);
  const parsed = parseSave(cloneDeep(original.oldInitialSave));
  expect(parsed).not.toBeNull();
  expect(parsed!.game.customScenario).toEqual(original.options.scenario);
  const forged = cloneDeep(original.oldInitialSave) as {
    game: { customScenario: { rules?: unknown } };
  };
  forged.game.customScenario.rules = {};
  expect(parseSave(forged)).toBeNull();
  expect(parseSave(cloneDeep(original.oldInitialSave))).not.toBeNull();
});

test("the upstream retirement upgrades an actual earlier custom save without changing its authored fleet", () => {
  const source = previous.cases.find((item) => item.oldInitialSave)!;
  loadSimData(getScenarioLocation(source.options.scenario)!);
  const upgraded = parseSave(cloneDeep(source.oldInitialSave));
  expect(upgraded).not.toBeNull();
  expect(upgraded!.game.customScenario!.mod).toBeUndefined();
  expect(upgraded!.game.customScenario!.eventScenarioIds).toEqual(
    source.options.scenario!.eventScenarioIds!.filter((id) => id !== 111),
  );
  expect(upgraded!.game.customScenario!.facilities).toEqual(
    source.options.scenario!.facilities,
  );
  expect(
    upgraded!.game.worldEvents.occurrences.some((event) =>
      event.key.startsWith("story:111:"),
    ),
  ).toBe(false);
});
