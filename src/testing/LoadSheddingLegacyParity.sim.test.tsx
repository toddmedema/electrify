import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { DIFFICULTY_IDS } from "../Constants";
import type { SimOptionsType } from "./Simulator";
import { runSimulation } from "./Simulator";

jest.setTimeout(120000);

interface LegacyCase {
  scenarioId: number;
  difficulty: string;
  seed: number;
  options: SimOptionsType;
  monthlyHistoryHash: string;
  finalFacilitiesHash: string;
  summary: unknown;
  objectiveResults: unknown;
  storyOccurrences: unknown;
  reachedStoryKeys: string[];
}
const reference: {
  baselineCommit: string;
  significantDigits: number;
  cases: LegacyCase[];
} = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/LoadSheddingLegacyReference.json"),
    "utf8",
  ),
);

beforeAll(() => {
  expect(reference.significantDigits).toBe(10);
  expect(
    reference.cases.map((item) => `${item.difficulty}:${item.seed}`).sort(),
  ).toEqual(
    [
      ...DIFFICULTY_IDS.map((difficulty) => `${difficulty}:12345`),
      "CEO:1",
    ].sort(),
  );
});

/** The same ten-significant-digit canonicalization used by the existing golden outputs. */
function canonical(value: unknown): unknown {
  if (typeof value === "number")
    return Number.isFinite(value)
      ? value === 0
        ? 0
        : Number(value.toPrecision(reference.significantDigits))
      : String(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

for (const expected of reference.cases)
  test(`Load Shedding preserves the old full route on ${expected.difficulty}, seed ${expected.seed}`, () => {
    const options = JSON.parse(JSON.stringify(expected.options));
    const result = runSimulation(options);
    expect(result.violations).toEqual([]);
    expect(result.outcome).toBe("completed");
    expect(result.months).toHaveLength(84);
    expect(digest(result.months)).toBe(expected.monthlyHistoryHash);
    expect(digest(result.finalFacilities)).toBe(expected.finalFacilitiesHash);
    expect(
      canonical({
        outcome: result.outcome,
        months: result.months.length,
        finalCash: result.finalCash,
        finalDebt: result.finalDebt,
        finalNetWorth: result.finalNetWorth,
        firedAtMonth: result.firedAtMonth,
        bankruptAtMonth: result.bankruptAtMonth,
        finalTransmissionLines: result.finalTransmissionLines,
        actionCount: result.actionCount,
        builds: result.builds,
        wildfireImpact: result.wildfireImpact,
        weatherHazardImpact: result.weatherHazardImpact,
      }),
    ).toEqual(expected.summary);
    expect(canonical(result.objectiveResults)).toEqual(
      expected.objectiveResults,
    );
    expect(canonical(result.storyOccurrences)).toEqual(
      expected.storyOccurrences,
    );
    expect(result.storyOccurrences.map((event) => event.key)).toEqual(
      expected.reachedStoryKeys,
    );
    expect(expected.reachedStoryKeys).toHaveLength(5);
  });
