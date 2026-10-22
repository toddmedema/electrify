import cloneDeep from "lodash.clonedeep";
import type { ScenarioType } from "../Types";
import { modScenario } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { createGame } from "../testing/Simulator";
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
      delete scenario.startingInterties;
      delete scenario.startingIntertieAccess;
    },
    (scenario) => {
      delete scenario.startingIntertieAccess;
    },
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

test("current111 is an official arc while ordinary Custom Game excludes it", () => {
  expect(validOfficialArcIds([111])).toBe(true);
  expect(validCustomEventIds([111])).toBe(false);
});

test("removing both researched starting facts cannot enable generic500MW access after rehash", () => {
  const original = modScenario(pack(), undefined, "Employee", 1e8);
  const game = createGame({
    scenarioId: 999,
    scenario: original,
    difficulty: "Employee",
    seed: 7,
  });
  const edited = cloneDeep(original);
  delete edited.startingIntertieAccess;
  delete edited.startingInterties;
  edited.mod!.setupDigest = modSetupDigest(edited);
  edited.mod!.runtimeDigest = modRuntimeDigest(edited.mod!);
  const unsafeContext = accessContextForGame({
    ...game,
    customScenario: edited,
  });
  expect(effectiveCorridor("california-north", unsafeContext)!.capacityW).toBe(
    500e6,
  );
  expect(validScenarioMod(edited.mod, edited)).toBe(false);
  expect(validScenarioMod(original.mod, original)).toBe(true);
  expect(
    effectiveCorridor("california-north", accessContextForGame(game))!
      .capacityW,
  ).toBe(40e6);
});
