import {
  resolveScenarioRuleTargets,
  survivingScenarioRuleTargets,
  type ScenarioRuleTargetFacility,
} from "./ScenarioRuleTargets";
import {
  CALIFORNIA_WILDFIRE_BALANCE,
  HURRICANE_BALANCE,
  resolveStoryAtDate,
  type StoryContextType,
} from "../data/WorldEvents";
import { getScenario } from "../data/Scenarios";
import { scenarioRules } from "./ScenarioRules";
import { DIFFICULTY_IDS, LOCATIONS } from "../Constants";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import type { ResolvedRuleSelector } from "../data/ScenarioRules";

const facility = (
  id: number,
  patch: Partial<ScenarioRuleTargetFacility> = {},
): ScenarioRuleTargetFacility => ({
  id,
  name: `Plant ${id}`,
  fuel: "Coal",
  ageYears: 10,
  peakW: 100,
  operational: true,
  minuteCreated: -1000 * id,
  ...patch,
});
const fleet = [
  facility(1, { peakW: 75, ageYears: 40, startingAssetId: "original-coal" }),
  facility(2, { peakW: 250, ageYears: 30 }),
  facility(3, { peakW: 175, ageYears: 30 }),
  facility(4, { peakW: 50, fuel: "Sun", ageYears: 3 }),
  facility(5, { peakW: 900, fuel: undefined }),
  facility(6, { peakW: 1000, operational: false }),
];
const resolve = (
  selector: ResolvedRuleSelector,
  facilities = fleet,
  seed = 42,
) =>
  resolveScenarioRuleTargets(selector, {
    seed,
    eventKey: "mod:test-grid:storm",
    facilities,
  });

test("largest and oldest use domain eligibility and stable ID tie-breaking", () => {
  expect(
    resolve({ selector: "largestOperating" }).targets.map((t) => t.id),
  ).toEqual([2]);
  expect(
    resolve({ selector: "largestOperating", fuel: "Sun" }).targets.map(
      (t) => t.id,
    ),
  ).toEqual([4]);
  expect(
    resolve({
      selector: "oldestOperating",
      fuel: "Coal",
      count: 2,
    }).targets.map((t) => t.id),
  ).toEqual([1, 2]);
  expect(
    resolve({
      selector: "oldestOperating",
      fuel: "Coal",
      count: 10,
    }).targets.map((t) => t.id),
  ).toEqual([1, 2, 3]);
  const tied = [facility(9, { peakW: 200 }), facility(7, { peakW: 200 })];
  expect(
    resolve({ selector: "largestOperating" }, tied).targets.map((t) => t.id),
  ).toEqual([7]);
  expect(
    resolve({ selector: "largestOperating" }, [...tied].reverse()),
  ).toEqual(resolve({ selector: "largestOperating" }, tied));
});

test("age threshold selects every qualifying operating generator at the exact boundary", () => {
  const result = resolve({
    selector: "operatingAtLeastAge",
    fuel: "Coal",
    minAgeYears: 30,
  });
  expect(result.targets.map((t) => t.id)).toEqual([1, 2, 3]);
  expect(
    resolve({
      selector: "operatingAtLeastAge",
      fuel: "Coal",
      minAgeYears: 30.001,
    }).targets.map((t) => t.id),
  ).toEqual([1]);
  expect(result.eligiblePeakW).toBe(500);
});

test("empty eligibility warns, while an intentional zero capacity share does not", () => {
  expect(resolve({ selector: "largestOperating", fuel: "Uranium" })).toEqual({
    targets: [],
    eligiblePeakW: 0,
    selectedPeakW: 0,
    noMatch: true,
  });
  expect(
    resolve({
      selector: "seededOperatingCapacityShare",
      targetCapacityShare: 0,
    }),
  ).toEqual({
    targets: [],
    eligiblePeakW: 550,
    selectedPeakW: 0,
    noMatch: false,
  });
  expect(
    resolve({ selector: "operatingAtLeastAge", fuel: "Coal", minAgeYears: 100 })
      .noMatch,
  ).toBe(true);
  expect(
    resolve({ selector: "largestOperating" }, [
      facility(1, { operational: false }),
      facility(2, { fuel: undefined }),
      facility(3, { peakW: 0 }),
    ]).noMatch,
  ).toBe(true);
});

test("seeded capacity share takes whole plants through the threshold without a fixed count", () => {
  const selector = {
    selector: "seededOperatingCapacityShare",
    targetCapacityShare: 0.51,
  } as const;
  const result = resolve(selector);
  expect(result.selectedPeakW).toBeGreaterThanOrEqual(
    result.eligiblePeakW * 0.51,
  );
  const last = result.targets[result.targets.length - 1];
  expect(result.selectedPeakW - last.peakW).toBeLessThan(
    result.eligiblePeakW * 0.51,
  );
  expect(result.targets.every((t) => t.id <= 4)).toBe(true);
  expect(resolve(selector, [...fleet].reverse())).toEqual(result);
  expect(resolve(selector, fleet, 43)).not.toEqual(result);
  const all = resolve({ ...selector, targetCapacityShare: 1 });
  expect(all.targets).toHaveLength(4);
  expect(all.selectedPeakW).toBe(550);
  expect(all.targets.slice(0, result.targets.length)).toEqual(result.targets);
});

test("an unrelated event resolution cannot shift an addressed target draw", () => {
  const selector = {
    selector: "seededOperatingCapacityShare",
    targetCapacityShare: 0.5,
  } as const;
  const before = resolve(selector);
  resolveScenarioRuleTargets(selector, {
    seed: 42,
    eventKey: "mod:test-grid:unrelated",
    facilities: fleet,
  });
  expect(resolve(selector)).toEqual(before);
});

test("starting-asset selection keeps a paused original and does not choose its replacement", () => {
  const original = facility(1, {
    operational: false,
    startingAssetId: "original-unit",
  });
  const selector = {
    selector: "startingAsset",
    assetId: "original-unit",
  } as const;
  expect(resolve(selector, [original]).targets.map((t) => t.id)).toEqual([1]);
  const replacement = facility(1, {
    name: "Larger replacement",
    peakW: 9999,
    minuteCreated: 100,
  });
  expect(resolve(selector, [replacement]).noMatch).toBe(true);
  expect(
    resolve(selector, [replacement, original]).targets.map((t) => t.name),
  ).toEqual([original.name]);
  const storage = facility(8, {
    fuel: undefined,
    operational: false,
    startingAssetId: "original-storage",
  });
  expect(
    resolve({ selector: "startingAsset", assetId: "original-storage" }, [
      storage,
    ]).targets.map((t) => t.id),
  ).toEqual([8]);
});

test("persisted bindings never transfer to a replacement reusing an integer ID", () => {
  const original = facility(1);
  const targets = resolve({ selector: "largestOperating" }, [original]).targets;
  expect(survivingScenarioRuleTargets(targets, [original])).toEqual(targets);
  expect(survivingScenarioRuleTargets(targets, [])).toEqual([]);
  expect(
    survivingScenarioRuleTargets(targets, [
      facility(1, { minuteCreated: 1000 }),
    ]),
  ).toEqual([]);
  // A month-one original can have the same ID and creation minute as a newly ordered plant.
  const openingOriginal = facility(1, {
    minuteCreated: 0,
    startingAssetId: "opening-unit",
  });
  const openingTargets = resolve({ selector: "largestOperating" }, [
    openingOriginal,
  ]).targets;
  expect(
    survivingScenarioRuleTargets(openingTargets, [
      facility(1, { minuteCreated: 0 }),
    ]),
  ).toEqual([]);
  expect(
    survivingScenarioRuleTargets(openingTargets, [openingOriginal]),
  ).toEqual(openingTargets);
});

test("selection and binding lookup leave caller facts and persisted activation names unchanged", () => {
  const input = [facility(1, { startingAssetId: "original-unit" })];
  const before = JSON.parse(JSON.stringify(input));
  const targets = resolve(
    { selector: "startingAsset", assetId: "original-unit" },
    input,
  ).targets;
  input[0].name = "Renamed original";
  const surviving = survivingScenarioRuleTargets(targets, input);
  expect(surviving[0].name).toBe(before[0].name);
  expect(surviving[0]).not.toBe(targets[0]);
  expect(input[0]).toEqual({ ...before[0], name: "Renamed original" });
});

describe.each([
  {
    scenarioId: 104,
    arcId: "hurricane-2008",
    phaseId: "landfall",
    balance: HURRICANE_BALANCE,
  },
  {
    scenarioId: 111,
    arcId: "california-wildfire-2025",
    phaseId: "firestorm",
    balance: CALIFORNIA_WILDFIRE_BALANCE,
  },
])(
  "trusted official $scenarioId addresses",
  ({ scenarioId, arcId, phaseId, balance }) => {
    test.each(DIFFICULTY_IDS)(
      "preserves %s target integration in the compiled native story resolver",
      (difficulty) => {
        const key = `story:${scenarioId}:${arcId}:${phaseId}`;
        for (const seed of [1, 42, 12345]) {
          const rules = scenarioRules(getScenario(scenarioId), {
            difficulty,
            seed,
          })!;
          const event = rules.events.find((item) => item.key === key)!;
          const context: StoryContextType = {
            rules,
            seed,
            scenarioId,
            difficulty,
            date: getDateFromMinute(
              event.startMonth * MINUTES_PER_MONTH,
              rules.startingYear,
            ),
            location: LOCATIONS.SF,
            snapshot: {
              facilities: fleet,
              demandWh12m: 1000,
              unservedWh12m: 0,
              deliveredWhByFuel12m: {},
              netIncome12m: 1,
              peakDemandW12m: 550,
              firmPeakW: 500,
              storagePeakW: 900,
              storagePeakWh: 1000,
            },
          };
          const current = resolveStoryAtDate(context).occurrences.find(
            (item) => item.key === key,
          )!;
          const result = resolveScenarioRuleTargets(
            {
              selector: "seededOperatingCapacityShare",
              targetCapacityShare: balance[difficulty].targetCapacityShare,
            },
            {
              seed,
              eventKey: "mod:test-grid:imported-storm",
              officialDrawKey: key,
              facilities: fleet,
            },
          );
          expect(result.targets.map((t) => t.id)).toEqual(
            current.attributes.selectedFacilityIds,
          );
          expect(result.targets.map((t) => t.name)).toEqual(
            current.attributes.selectedFacilityNames,
          );
          expect(
            resolveScenarioRuleTargets(
              {
                selector: "seededOperatingCapacityShare",
                targetCapacityShare: balance[difficulty].targetCapacityShare,
              },
              {
                seed,
                eventKey: "mod:test-grid:imported-storm",
                officialDrawKey: key,
                facilities: [...fleet].reverse(),
              },
            ),
          ).toEqual(result);
        }
      },
    );
  },
);
