import fs from "fs";
import path from "path";
import cloneDeep from "lodash.clonedeep";
import type { ScenarioType } from "../Types";
import { modScenario } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { createGame } from "../testing/Simulator";
import { parseSave } from "../SaveGame";
import {
  accessContextForGame,
  effectiveCorridor,
  effectiveMarket,
} from "../data/IntertieAccess";
import {
  modRuntimeDigest,
  modSetupDigest,
  validScenarioMod,
} from "./ScenarioMod";
import {
  frozenWildfireStartingIntertieAccess,
  validFrozenStartingIntertieAccess,
} from "./FrozenStartingInterties";
import {
  validCustomEventIds,
  validOfficialArcIds,
} from "./CustomScenarioEvents";

const pack = (): ModPackage => ({
  schemaVersion: 1,
  gameApi: 1,
  id: "frozen-intertie",
  title: "Frozen intertie",
  creator: "Test",
  version: "1",
  description: "Prepare a replacement supply.",
  seed: 7,
  baseScenarioId: 111,
  officialArcs: [],
  objectives: { mode: "none" },
});
const legacy: {
  cases: { group: number; difficulty: string; scenario: ScenarioType }[];
  oldEnvelopeCases: { save: unknown }[];
} = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../testing/fixtures/FrozenLegacyArcSnapshots.json"),
    "utf8",
  ),
);

test("fresh base-111 community setup freezes the native40MW connection and access rather than the500MW regional route", () => {
  const scenario = modScenario(pack(), undefined, "Employee", 1e8);
  expect(validScenarioMod(scenario.mod, scenario)).toBe(true);
  expect(scenario.startingInterties).toEqual(["california-north"]);
  const game = createGame({
    scenarioId: 999,
    scenario,
    difficulty: "Employee",
    seed: 7,
  });
  expect(game.transmission!.lines).toEqual([
    expect.objectContaining({
      corridorId: "california-north",
      capacityW: 40e6,
      yearsToBuildLeft: 0,
      loanAmountLeft: 0,
      financed: false,
    }),
  ]);
  const context = accessContextForGame(game);
  expect(effectiveCorridor("california-north", context)!.capacityW).toBe(40e6);
  expect(effectiveCorridor("california-south", context)!.capacityW).toBe(15e6);
  expect(
    effectiveMarket("california-north", context, 40e6)!.availableSupplyW,
  ).toBe(40e6);
  expect(
    effectiveMarket("california-north", context, 60e6)!.availableSupplyW,
  ).toBe(45e6);
  expect(scenario.startingIntertieAccess).toEqual(
    frozenWildfireStartingIntertieAccess(),
  );
});

test("forged frozen allocation, source, location and starting assets fail even with recomputed digests", () => {
  const original = modScenario(pack(), undefined, "Employee", 1e8);
  const edits: ((scenario: ScenarioType) => void)[] = [
    (scenario) => {
      scenario.startingIntertieAccess!.allocations[0].capacityW = 500e6;
    },
    (scenario) => {
      scenario.startingIntertieAccess!.allocations[0].availableSupplyW = 500e6;
    },
    (scenario) => {
      scenario.mod!.parameters.baseScenarioId = 999;
    },
    (scenario) => {
      scenario.locationId = "SF";
    },
    (scenario) => {
      scenario.startingInterties!.push("california-south");
    },
    (scenario) => {
      scenario.startingInterties = undefined;
    },
  ];
  for (const edit of edits) {
    const scenario = cloneDeep(original);
    edit(scenario);
    scenario.mod!.setupDigest = modSetupDigest(scenario);
    scenario.mod!.runtimeDigest = modRuntimeDigest(scenario.mod!);
    expect(validScenarioMod(scenario.mod, scenario)).toBe(false);
  }
  expect(validScenarioMod(original.mod, original)).toBe(true);
  const reordered = frozenWildfireStartingIntertieAccess();
  reordered.allocations.reverse();
  expect(validFrozenStartingIntertieAccess(reordered)).toBe(true);
});

test("old community setup and schema3/4 envelopes retain arc111 and never gain new starting rights", () => {
  const original = legacy.cases.find(
    (entry) => entry.group === 1 && entry.difficulty === "Employee",
  )!.scenario;
  expect(original.eventScenarioIds).toContain(111);
  expect(validOfficialArcIds(original.eventScenarioIds)).toBe(true);
  expect(validCustomEventIds([111])).toBe(false);
  expect(validScenarioMod(original.mod, original)).toBe(true);
  const game = createGame({
    scenarioId: 999,
    scenario: cloneDeep(original),
    difficulty: "Employee",
    seed: original.seed,
  });
  expect(game.transmission!.lines).toEqual([]);
  expect(
    effectiveCorridor("california-north", accessContextForGame(game))!
      .capacityW,
  ).toBe(500e6);
  for (const schemaVersion of [3, 4]) {
    const envelope = cloneDeep(legacy.oldEnvelopeCases[0].save) as {
      schemaVersion: number;
      game: { customScenario: ScenarioType };
    };
    envelope.schemaVersion = schemaVersion;
    const savedSetup = cloneDeep(envelope.game.customScenario);
    const restored = parseSave(envelope);
    expect(restored).not.toBeNull();
    expect(restored!.game.customScenario).toEqual(savedSetup);
    expect(restored!.game.customScenario!.eventScenarioIds).toContain(111);
    const forged = cloneDeep(envelope);
    forged.game.customScenario.mod = {} as ScenarioType["mod"];
    expect(parseSave(forged)).toBeNull();
  }
});
