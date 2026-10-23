import { loadSimData } from "../testing/SimData";
import { modScenario, modResolvedSetup } from "./ModScenario";
import { getScenarioLocation } from "../helpers/Locations";
import { validScenarioMod } from "../helpers/ScenarioMod";
import { buildModPublication, modPlayerFacts } from "./ModAuthoring";
import { modDiagnostics } from "./ModSchema";
import { validateMod } from "./ModSchema";

const minimal = {
  schemaVersion: 1 as const,
  gameApi: 1,
  id: "simple-grid",
  title: "Simple grid",
  creator: "Author",
  version: "1",
  description: "Build a reliable grid.",
};

test("a scenario needs no base, seed or objective mode", () => {
  expect(validateMod(minimal)).toEqual(minimal);
  expect(validateMod({ ...minimal, objectives: [] }).objectives).toEqual([]);
});

test("independent setup, date text and omitted defaults survive a frozen snapshot", () => {
  const input = {
    ...minimal,
    description: "Prepare by {{start+12 months}}.",
    scenario: {
      startingYear: 2040,
      durationMonths: 24,
      startingCustomers: 1000,
      cash: 1e9,
      location: {
        id: "SF",
        name: "San Francisco",
        lat: 37.7749,
        long: -122.4194,
      },
      startingFleet: [{ id: "peaker", name: "Natural Gas Peaker", peakMW: 10 }],
      endMessage: "Work began in {{start}}.",
    },
    events: [
      {
        id: "outage",
        title: "Outage",
        message: "Offline until {{event+3 months}}.",
        startMonth: 13,
        durationMonths: 3,
        effects: {
          outputMultipliersBySelector: [
            {
              target: { selector: "startingAsset", assetId: "peaker" },
              outputMultiplier: 0,
            },
          ],
        },
      },
    ],
  };
  const pack = validateMod(input);
  loadSimData(getScenarioLocation(modResolvedSetup(pack))!);
  const scenario = modScenario(pack, undefined, "Employee");
  expect(scenario.facilities).toHaveLength(1);
  expect(scenario.facilities[0]).toEqual(
    expect.objectContaining({
      assetId: "peaker",
      peakW: 10e6,
      initialAgeYears: 0,
    }),
  );
  expect(scenario.seed).toBe(0);
  expect(scenario.mod!.parameters.baseScenarioId).toBe(999);
  expect(scenario.endMessage).toBe("Work began in January 2040.");
  expect(scenario.mod!.rules.events[0].message).toBe(
    "Offline until April 2041.",
  );
  const restored = JSON.parse(JSON.stringify(scenario));
  expect(validScenarioMod(restored.mod, restored)).toBe(true);
  expect(JSON.stringify(modPlayerFacts(scenario))).not.toContain("{{");
  expect(buildModPublication(pack).description).toContain(
    "Prepare by January 2041.",
  );
  expect(pack).toEqual(input);
});

test("omitted goals inherit a base's requirements; a supplied list replaces them", () => {
  loadSimData("SF");
  const input = { ...minimal, baseScenarioId: 100, officialArcs: [] };
  expect(
    modScenario(input).mod!.rules.objectives.some((o) => o.inherited),
  ).toBe(true);
  expect(
    modScenario({ ...input, objectives: [] }).mod!.rules.objectives,
  ).toEqual([]);
  expect(() =>
    validateMod({ ...minimal, objectives: { mode: "none" } }),
  ).toThrow();
});

test.each([
  { description: "Prepare in {{event+2 months}}." },
  { description: "Prepare in {{unknown}}." },
  { description: "{{start}}".repeat(200) },
  { seed: null },
  { objectives: null },
  {
    scenario: {
      location: { id: "../weather", name: "Bad path", lat: 1, long: 1 },
    },
  },
  { scenario: { startingFleet: [{ name: "Nuclear", peakMW: -1 }] } },
  {
    scenario: {
      startingFleet: [
        { id: "same", name: "Coal", peakMW: 1 },
        { id: "same", name: "Coal", peakMW: 1 },
      ],
    },
  },
])("rejects invalid optional authoring data %j", (patch) => {
  expect(modDiagnostics({ ...minimal, ...patch }).length).toBeGreaterThan(0);
});

test("template scope and expanded text limits report actionable paths", () => {
  expect(
    modDiagnostics({ ...minimal, description: "Due {{event+2 months}}" }),
  ).toContainEqual(
    expect.objectContaining({ code: "date-template", path: "description" }),
  );
  expect(
    modDiagnostics({ ...minimal, description: "{{start}}".repeat(200) }),
  ).toContainEqual(
    expect.objectContaining({ code: "text-limit", path: "description" }),
  );
  expect(
    modDiagnostics({ ...minimal, description: "Due {{start+2 months}}" }),
  ).toEqual([]);
});
