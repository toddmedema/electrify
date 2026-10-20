import { tickState } from "../reducers/Game";
import { TICKS_PER_MONTH } from "../Constants";
import { TextEncoder } from "util";
import { modScenario } from "./Packages";
import { parseMod, ModPackage, MOD_SCENARIO_IDS } from "../data/ModSchema";
import manifest from "../data/RunCompatibility.json";
import { createGame } from "../testing/Simulator";
import { DEFAULT_CUSTOM_SCENARIO, SCENARIOS } from "../data/Scenarios";
import { GENERATORS, STORAGE } from "../data/Facilities";
import { policyTotalCost } from "../helpers/Policies";
import { serializeSave, parseSave } from "../SaveGame";
import { serializeReplay } from "../Replay";
Object.assign(global, { TextEncoder });
const fixture = (): ModPackage => ({
  schemaVersion: 1,
  id: "test-grid",
  title: "Test Grid",
  creator: "Creator",
  version: "1",
  rules: manifest.compatibilityId,
  seed: 42,
  baseScenarioId: 999,
  facilities: {
    Solar: { buildCost: 0.5 },
    Battery: { annualOperatingCost: 2 },
  },
  programs: { efficiency: 0.5 },
});

test("valid content resolves to a detached unranked scenario with seed and rules provenance", () => {
  const pack = fixture();
  const scenario = modScenario(pack);
  expect(scenario.id).toBe(999);
  expect(scenario.seed).toBe(42);
  pack.facilities!.Solar.buildCost = 9;
  expect(scenario.modPackage!.facilities!.Solar.buildCost).toBe(0.5);
  expect(() => modScenario({ ...fixture(), rules: "rules-old" })).toThrow(
    /different game rules/,
  );
  expect(() => modScenario({ ...fixture(), baseScenarioId: 998 })).toThrow(
    /Invalid mod package/,
  );
  expect(() =>
    modScenario({ ...fixture(), scenario: { eventScenarioIds: [998] } }),
  ).toThrow();
  expect(() =>
    parseMod(JSON.stringify({ ...fixture(), engineScript: "bad" })),
  ).toThrow();
});
test("facility and program modifiers are run-local, survive save loading, and cannot create official replay submissions", () => {
  const regular = createGame({
    scenarioId: 999,
    scenario: { ...DEFAULT_CUSTOM_SCENARIO },
    seed: 42,
    difficulty: "Manager",
  });
  const modded = createGame({
    scenarioId: 999,
    scenario: modScenario(fixture()),
    seed: 42,
    difficulty: "Manager",
  });
  const solar = (game: typeof regular) =>
    GENERATORS(game, 1e8, [10], [100]).find((g) => g.name === "Solar")!;
  expect(solar(modded).buildCost).toBe(solar(regular).buildCost * 0.5);
  expect(STORAGE(modded, 1e8)[0].annualOperatingCost).toBe(
    STORAGE(regular, 1e8)[0].annualOperatingCost * 2,
  );
  expect(policyTotalCost(modded, "efficiency", 1)).toBe(
    policyTotalCost(regular, "efficiency", 1) * 0.5,
  );
  expect(modded.runIdentity).toBeUndefined();
  expect(serializeReplay(modded)).toBeUndefined();
  const save = serializeSave(modded);
  const restored = parseSave(JSON.parse(JSON.stringify(save)));
  expect(restored?.game.customScenario?.modPackage).toEqual(fixture());
  const invalid = JSON.parse(JSON.stringify(save));
  invalid.game.customScenario.modPackage.programs.solar = -1;
  expect(parseSave(invalid)).toBeNull();
});

test("native schema catalog matches all non-tutorial scenarios", () => {
  expect([...MOD_SCENARIO_IDS].sort()).toEqual(
    SCENARIOS.filter((s) => !s.tutorialSteps)
      .map((s) => s.id)
      .sort(),
  );
});

test("mod notifications are committed once and survive save loading", () => {
  const pack = {
    ...fixture(),
    notifications: [
      { month: 1, title: "Review grid", message: "Check the first month." },
    ],
  };
  const game = createGame({
    scenarioId: 999,
    scenario: modScenario(pack),
    seed: 42,
    difficulty: "Manager",
  });
  for (let i = 0; i < TICKS_PER_MONTH; i++) tickState(game);
  expect(
    game.eventLog.filter((event) => event.title === "Review grid"),
  ).toHaveLength(1);
  const restored = parseSave(JSON.parse(JSON.stringify(serializeSave(game))))!;
  expect(restored.game.reportedEventKeys).toContain("mod-notice:0");
  for (let i = 0; i < 4; i++) tickState(restored.game);
  expect(
    restored.game.eventLog.filter((event) => event.title === "Review grid"),
  ).toHaveLength(1);
});
