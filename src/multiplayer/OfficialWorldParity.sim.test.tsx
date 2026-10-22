import fs from "fs";
import path from "path";
import { getScenario } from "../data/Scenarios";
import {
  OFFICIAL_WORLD_IDS,
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
  expect(reference.cases).toHaveLength(15);
  const paired = reference.cases.filter((item) => item.variant === "paired");
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
  const split = reference.cases.filter(
    (item) => item.variant === "split-shutdown",
  );
  expect(split).toHaveLength(1);
  expect(split[0].scenarioId).toBe(110);
  expect(split[0].outcomes["0"]).toEqual(
    expect.objectContaining({ outcome: "completed", month: 60 }),
  );
  expect(split[0].outcomes["1"]).toEqual(
    expect.objectContaining({ outcome: "fired", month: 56 }),
  );
});

for (const expected of reference.cases)
  test(`official ${expected.scenarioId} ${expected.variant} preserves the entire old two-company World`, () => {
    expect(
      playOfficialWorldRoute(expected.scenarioId, expected.variant),
    ).toEqual(expected);
  });
