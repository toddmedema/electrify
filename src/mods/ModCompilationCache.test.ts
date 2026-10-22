import { DIFFICULTY_IDS } from "../Constants";
import { getScenarioLocation } from "../helpers/Locations";
import * as compiler from "../helpers/ScenarioRules";
import * as peak from "../helpers/ScenarioStartingPeak";
import { loadSimData } from "../testing/SimData";
import {
  modAuthoringScenarios,
  modResolvedSetup,
  modScenario,
  modValidationDiagnostics,
} from "./ModScenario";
import type { ModPackage } from "./ModSchema";

const pack = (id: string): ModPackage => ({
  schemaVersion: 1,
  gameApi: 1,
  id,
  title: "Cached operating plan",
  creator: "Fixture author",
  version: "1",
  description: "A small operating plan with all difficulty values.",
  seed: 42,
  baseScenarioId: 999,
  officialArcs: [],
  scenario: { durationMonths: 12 },
  objectives: { mode: "none" },
  events: [
    {
      id: "conditions",
      title: "Operating conditions",
      message: "The operating conditions apply.",
      preview: "The operating conditions will apply.",
      startMonth: 2,
      durationMonths: "untilEnd",
      effects: {
        demandMultiplier: {
          byDifficulty: {
            Intern: 0.9,
            Employee: 1,
            Manager: 1.1,
            VP: 1.2,
            CEO: 1.3,
          },
        },
      },
    },
  ],
});
beforeAll(() =>
  loadSimData(getScenarioLocation(modResolvedSetup(pack("cache-setup")))!),
);
afterEach(() => jest.restoreAllMocks());

test("one validated compilation serves every difficulty and author tool without exposing mutable cache data", () => {
  const input = pack("cache-all-difficulties");
  const compile = jest.spyOn(compiler, "compileScenarioRules");
  const first = modScenario(input);
  const calls = compile.mock.calls.length;
  expect(calls).toBeGreaterThanOrEqual(DIFFICULTY_IDS.length);
  const second = modScenario(JSON.parse(JSON.stringify(input)));
  expect(second).toEqual(first);
  expect(second).not.toBe(first);
  second.mod!.rules.events[0].effects.demandMultiplier = 9;
  second.facilities[0].peakW = 1;
  for (const difficulty of DIFFICULTY_IDS) {
    const resolved = modScenario(input, undefined, difficulty);
    expect(resolved.mod!.parameters.difficulty).toBe(difficulty);
    expect(resolved.mod!.rules.events[0].effects.demandMultiplier).toBe(
      (
        input.events![0].effects!.demandMultiplier as {
          byDifficulty: Record<string, number>;
        }
      ).byDifficulty[difficulty],
    );
    expect(resolved.facilities).toEqual(first.facilities);
  }
  const author = modAuthoringScenarios(input);
  expect(Object.keys(author.scenarios).sort()).toEqual(
    [...DIFFICULTY_IDS].sort(),
  );
  expect(modValidationDiagnostics(input)).toEqual(author.diagnostics);
  expect(compile.mock.calls.length).toBe(calls);
  expect(modScenario(input)).toEqual(first);
});

test("package edits, source identity and real peak readiness cannot reuse a stale compiled snapshot", () => {
  const input = pack("cache-input-boundaries");
  const unavailable = jest
    .spyOn(peak, "resolvedScenarioStartingPeak")
    .mockReturnValue(undefined);
  const cold = modScenario(input);
  expect(cold.mod!.rules.startingPeakW).toBe(0);
  unavailable.mockRestore();
  const ready = modScenario(input);
  expect(ready.mod!.rules.startingPeakW).toBeGreaterThan(0);
  const explicit = modScenario(input, undefined, "Employee", 100e6);
  expect(explicit.mod!.rules.startingPeakW).toBe(100e6);
  const otherPeak = modScenario(input, undefined, "Employee", 200e6);
  expect(otherPeak.mod!.rules.startingPeakW).toBe(200e6);
  const workshop = modScenario(input, "123");
  expect(workshop.mod!.source.workshopId).toBe("123");
  expect(modScenario(input).mod!.source.workshopId).toBeUndefined();
  const changed = modScenario({
    ...input,
    seed: 43,
    title: "Edited operating plan",
  });
  expect(changed.seed).toBe(43);
  expect(changed.name).toBe("Edited operating plan");
  expect(changed.mod!.packageDigest).not.toBe(ready.mod!.packageDigest);
  expect(() =>
    modScenario({ ...input, engineScript: "bad" } as ModPackage),
  ).toThrow(/engineScript/);
  expect(modScenario(input)).toEqual(ready);
});
