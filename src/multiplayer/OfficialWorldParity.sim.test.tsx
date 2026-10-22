import fs from "fs";
import path from "path";
import { getScenario } from "../data/Scenarios";
import type { MonthlyHistoryType } from "../Types";
import {
  gameObjectiveResults,
  validGameObjectiveProgress,
} from "../helpers/ObjectiveRules";
import {
  OFFICIAL_WORLD_IDS,
  canonicalOfficialWorld,
  playOfficialWorldRoute,
} from "../testing/OfficialWorldRoutes";

jest.setTimeout(120000);
interface LegacyWorldCase {
  scenarioId: number;
  variant: "paired" | "split-shutdown";
  companies: { months: number }[];
  outcomes: Record<string, { outcome: string; month: number }>;
}
const reference: {
  baselineCommit: string;
  significantDigits: number;
  cases: LegacyWorldCase[];
} = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../testing/fixtures/OfficialLegacyWorlds.json"),
    "utf8",
  ),
);
const upstream: {
  baselineCommit: string;
  significantDigits: number;
  world: LegacyWorldCase & {
    phaseCheckpoints: {
      month: number;
      companies: {
        objectiveObservation: { reliabilityMonths: MonthlyHistoryType[] };
      }[];
    }[];
  };
} = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../testing/fixtures/UpstreamWildfireWorldCustomReference.json",
    ),
    "utf8",
  ),
);
// #602 intentionally replaced native 111 after the original migration capture.
// Preserve that old fixture verbatim; current 111 uses the independent upstream
// callback oracle, while every unchanged challenge keeps its original reference.
const cases = reference.cases.map((item) =>
  item.scenarioId === 111 ? upstream.world : item,
);

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("the independent World matrix covers every native full term and a split company outcome", () => {
  expect(reference.baselineCommit).toBe(
    "2fc5d50ebedd5d3695b9db7d75ca5b54c0912779",
  );
  expect(reference.significantDigits).toBe(10);
  expect(upstream.baselineCommit).toBe(
    "b4afcd80c173934650a71e0e7586e8732d1b233e",
  );
  expect(upstream.significantDigits).toBe(10);
  expect(reference.cases).toHaveLength(15);
  expect(cases).toHaveLength(15);
  const paired = cases.filter((item) => item.variant === "paired");
  expect(paired.map((item) => item.scenarioId)).toEqual([
    ...OFFICIAL_WORLD_IDS,
  ]);
  for (const item of paired) {
    expect(item.companies.map((company) => company.months)).toEqual([
      getScenario(item.scenarioId)!.durationMonths,
      getScenario(item.scenarioId)!.durationMonths,
    ]);
    expect(
      Object.values(item.outcomes).map((outcome) => outcome.outcome),
    ).toEqual(["completed", "completed"]);
  }
  const split = cases.filter((item) => item.variant === "split-shutdown");
  expect(split).toHaveLength(1);
  expect(split[0].scenarioId).toBe(110);
  expect(split[0].outcomes["0"]).toEqual(
    expect.objectContaining({ outcome: "completed", month: 60 }),
  );
  expect(split[0].outcomes["1"]).toEqual(
    expect.objectContaining({ outcome: "fired", month: 56 }),
  );
});

for (const expected of reference.cases.filter(
  (item) => item.scenarioId !== 111,
))
  test(`official ${expected.scenarioId} ${expected.variant} preserves the entire old two-company World`, () => {
    expect(
      playOfficialWorldRoute(expected.scenarioId, expected.variant),
    ).toEqual(expected);
  });

test("redesigned native 111 preserves the upstream full World and adds truthful compact goal progress", () => {
  const seen: number[] = [];
  const actual = playOfficialWorldRoute(111, "paired", (game, index, month) => {
    const rows =
      month === 0
        ? []
        : upstream.world.phaseCheckpoints.find((item) => item.month === month)!
            .companies[index].objectiveObservation.reliabilityMonths;
    expect(validGameObjectiveProgress(game)).toBe(true);
    expect(game.objectiveProgress!.completedMonths).toBe(month);
    expect(game.objectiveProgress!.entries).toHaveLength(1);
    expect(game.objectiveProgress!.entries[0].duplicateMonths).toEqual([]);
    expect(
      canonicalOfficialWorld(game.objectiveProgress!.entries[0].observations),
    ).toEqual(
      canonicalOfficialWorld(
        rows
          .map((row) => [
            (row.year - game.startingYear) * 12 + row.month - 1,
            row.supplyWh,
            row.demandWh,
          ])
          .sort((left, right) => left[0] - right[0]),
      ),
    );
    const results = gameObjectiveResults(game);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      metric: "monthlyReliability",
      required: true,
      observedMonths: rows.length,
      requiredMonths: 2,
      target: 0.995,
      status: ["pending", "inProgress", "completed"][rows.length],
    });
    // #605 adds exactly these four catalog identities; the shared comparison
    // validates each original asset before projecting only that added field.
    expect(
      game.facilities
        .filter((facility) => facility.startingAssetId)
        .map((facility) => facility.startingAssetId)
        .sort(),
    ).toEqual([
      "scenario-111-battery",
      "scenario-111-natural-gas-cc",
      "scenario-111-sun",
      "scenario-111-wind",
    ]);
    seen.push(month);
  });
  expect(seen).toEqual([0, 0, 35, 35, 36, 36, 37, 37, 38, 38, 60, 60]);
  expect(actual).toEqual(upstream.world);
});
