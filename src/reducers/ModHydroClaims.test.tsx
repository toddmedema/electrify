import "../Store";
import cloneDeep from "lodash.clonedeep";
import {
  getHydroAvailability,
  getHydroInventoryKey,
  HYDRO_SITES,
  validHydroClaims,
} from "../data/HydroSites";
import { DEFAULT_CUSTOM_SCENARIO, getScenario } from "../data/Scenarios";
import { getScenarioLocation } from "../helpers/Locations";
import {
  modRuntimeDigest,
  modSetupDigest,
  validScenarioMod,
} from "../helpers/ScenarioMod";
import { modResolvedSetup, modScenario } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { modPackage } from "../testing/ModFixtures";
import { parseSave, serializeSave } from "../SaveGame";
import { loadSimData } from "../testing/SimData";
import { createGame, runSimulation } from "../testing/Simulator";
import type { ScenarioType } from "../Types";
import { tickState } from "./Game";
import { roundTrip } from "../testing/SaveForgery";

const pack = (): ModPackage =>
  modPackage({
    id: "inherited-hydro",
    title: "Inherited Hydro",
    creator: "Fixture author",
    description: "Operate the inherited Lusaka grid through its first months.",
    baseScenarioId: 114,
    scenario: { durationMonths: 6 },
    officialArcs: [],
    objectives: [],
  });
function scenario(): ScenarioType {
  const input = pack();
  const location = getScenarioLocation(modResolvedSetup(input));
  if (!location) throw new Error("The inherited grid must have a location.");
  loadSimData(location);
  return modScenario(input, undefined, "Employee");
}
const options = (resolved: ScenarioType) => ({
  scenarioId: 999,
  scenario: resolved,
  difficulty: "Employee" as const,
  seed: 42,
});
function rehash(resolved: ScenarioType) {
  if (!resolved.mod) throw new Error("The fixture requires mod provenance.");
  resolved.mod.setupDigest = modSetupDigest(resolved);
  resolved.mod.runtimeDigest = modRuntimeDigest(resolved.mod);
}

test("a mod inherits its base's researched Hydro inventory through ticks and saves", () => {
  const resolved = scenario();
  const original = cloneDeep(resolved);
  const game = createGame(options(resolved));
  expect(getHydroInventoryKey(game)).toBe("scenario:114");
  expect(validHydroClaims(game)).toBe(true);
  expect(game.facilities.find((facility) => facility.fuel === "Hydro")).toEqual(
    expect.objectContaining({ peakW: 435e6, hydroSiteId: "kariba-zmb" }),
  );
  expect(game.commissionedHydroSiteIds).toContain("kariba-zmb");
  expect(
    getHydroAvailability(game, 1e6).remaining.map((site) => site.id),
  ).toContain("victoria-falls-zmb");
  tickState(game);
  expect(validHydroClaims(game)).toBe(true);
  const saved = roundTrip(game);
  const restored = parseSave(saved);
  expect(restored).not.toBeNull();
  expect(getHydroInventoryKey(restored!.game)).toBe("scenario:114");
  expect(restored!.game.commissionedHydroSiteIds).toEqual(
    game.commissionedHydroSiteIds,
  );
  expect(restored!.game.facilities).toEqual(
    JSON.parse(JSON.stringify(game.facilities)),
  );
  expect(runSimulation({ ...options(resolved), months: 2 }).violations).toEqual(
    [],
  );
  expect(resolved).toEqual(original);
});

test("ordinary custom Lusaka games retain their local inventory and cannot inject an exception", () => {
  const base = getScenario(114)!;
  const custom: ScenarioType = {
    ...cloneDeep(base),
    id: DEFAULT_CUSTOM_SCENARIO.id,
    seed: 42,
  };
  delete custom.hydroInventoryKey;
  const game = createGame(options(custom));
  expect(getHydroInventoryKey(game)).toBe("Lusaka");
  expect(validHydroClaims(game)).toBe(true);
  expect(
    getHydroAvailability(game, 1e6).remaining.map((site) => site.id),
  ).not.toContain("victoria-falls-zmb");
  game.customScenario!.hydroInventoryKey = "scenario:114";
  expect(validHydroClaims(game)).toBe(false);
  expect(parseSave(roundTrip(game))).toBeNull();
});

test("edited inherited inventory metadata is rejected even after setup and runtime digests are recomputed", () => {
  const valid = scenario();
  expect(validScenarioMod(valid.mod, valid)).toBe(true);
  const edits: ((copy: ScenarioType) => void)[] = [
    (copy) => {
      copy.hydroInventoryKey = "Lusaka";
    },
    (copy) => {
      delete copy.hydroInventoryKey;
    },
    (copy) => {
      copy.mod!.parameters.baseScenarioId = 999;
    },
  ];
  for (const edit of edits) {
    const forged = cloneDeep(valid);
    edit(forged);
    rehash(forged);
    expect(validScenarioMod(forged.mod, forged)).toBe(false);
    expect(validScenarioMod(valid.mod, valid)).toBe(true);
  }
  const malformed = JSON.parse(
    JSON.stringify(serializeSave(createGame(options(valid)))),
  );
  delete malformed.game.customScenario.mod.parameters;
  delete malformed.game.customScenario.hydroInventoryKey;
  expect(validHydroClaims(malformed.game)).toBe(false);
  expect(parseSave(malformed)).toBeNull();
});

test("inheriting a researched inventory still rejects forged claims, capacity and coordinates", () => {
  const game = createGame(options(scenario()));
  expect(validHydroClaims(game)).toBe(true);
  const edits: ((copy: typeof game) => void)[] = [
    (copy) => {
      copy.location.lat += 1;
    },
    (copy) => {
      copy.commissionedHydroSiteIds.push("kariba-zmb");
    },
    (copy) => {
      copy.commissionedHydroSiteIds.push("invented");
    },
    (copy) => {
      copy.facilities.find((facility) => facility.fuel === "Hydro")!.peakW =
        HYDRO_SITES["kariba-zmb"].maxPeakW + 1;
    },
    (copy) => {
      copy.facilities.find(
        (facility) => facility.fuel === "Hydro",
      )!.hydroSiteId = "victoria-falls-zmb";
    },
  ];
  for (const edit of edits) {
    const forged = cloneDeep(game);
    edit(forged);
    expect(validHydroClaims(forged)).toBe(false);
    expect(parseSave(roundTrip(forged))).toBeNull();
  }
  expect(validHydroClaims(game)).toBe(true);
});
