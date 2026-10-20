import { TextEncoder } from "util";
import {
  FACILITY_MODIFIER_KEYS,
  FACILITY_NAMES,
  MOD_API_VERSION,
  MOD_SCENARIO_IDS,
  ModProgramId,
  ModScenarioOverrides,
  PROGRAM_KEYS,
  SCENARIO_OVERRIDE_KEYS,
} from "./ModSchema";
import { SCENARIOS } from "../data/Scenarios";
import { GENERATORS, STORAGE } from "../data/Facilities";
import { createGame } from "../testing/Simulator";
import * as ScenarioMod from "../helpers/ScenarioMod";
import type { BuildoutPolicyId } from "../helpers/Policies";
import type { FacilityModifierType, ModFacilityNameType } from "../Types";
Object.assign(global, { TextEncoder });

// Each literal must name every key of its type exactly once, or this file stops compiling.
const OVERRIDE_KEYS: Record<keyof ModScenarioOverrides, true> = {
  cash: true,
  startingYear: true,
  startingCustomers: true,
  startingDemandScale: true,
  dollarsPerkWh: true,
  durationMonths: true,
  feePerKgCO2e: true,
  eventScenarioIds: true,
  ownership: true,
  endTitle: true,
  endMessage: true,
};
const MODIFIER_KEYS: Record<keyof FacilityModifierType, true> = {
  buildCost: true,
  annualOperatingCost: true,
  yearsToBuild: true,
};
const PROGRAMS: Record<ModProgramId, true> = { efficiency: true, solar: true };
const FACILITIES: Record<ModFacilityNameType, true> = {
  Coal: true,
  Nuclear: true,
  "Natural Gas Peaker": true,
  "Natural Gas CC": true,
  Oil: true,
  Biomass: true,
  Wind: true,
  "Offshore Wind": true,
  "Airborne Wind": true,
  Solar: true,
  Hydro: true,
  Geothermal: true,
  "Enhanced Geothermal": true,
  Battery: true,
  "Pumped Hydro": true,
};
// Mod programs are exactly the build-out programs whose cost a mod can scale.
const programIds: BuildoutPolicyId[] = Object.keys(PROGRAMS) as ModProgramId[];
const sorted = (values: readonly string[]) => [...values].sort();

test("the JavaScript validator's key lists match the TypeScript model", () => {
  expect(sorted(SCENARIO_OVERRIDE_KEYS)).toEqual(
    sorted(Object.keys(OVERRIDE_KEYS)),
  );
  expect(sorted(FACILITY_MODIFIER_KEYS)).toEqual(
    sorted(Object.keys(MODIFIER_KEYS)),
  );
  expect(sorted(PROGRAM_KEYS)).toEqual(sorted(programIds));
  expect(sorted(FACILITY_NAMES)).toEqual(sorted(Object.keys(FACILITIES)));
});

test("mod facility names are exactly the buildable generator and storage catalog", () => {
  // Every catalog entry asks for its modifier before availability filtering.
  const asked = jest.spyOn(ScenarioMod, "facilityModifier");
  const game = createGame({ scenarioId: 100, seed: 1, difficulty: "Manager" });
  asked.mockClear();
  GENERATORS(game, 1e8, [10], [100]);
  STORAGE(game, 1e8);
  const catalog = asked.mock.calls.map(([, name]) => name);
  asked.mockRestore();
  expect(sorted(FACILITY_NAMES)).toEqual(sorted([...new Set(catalog)]));
});

test("mod base scenarios are every non-tutorial scenario", () => {
  expect([...MOD_SCENARIO_IDS].sort()).toEqual(
    SCENARIOS.filter((s) => !s.tutorialSteps)
      .map((s) => s.id)
      .sort(),
  );
});

/**
 * Packages declare the game contract version they were written for. Ordinary releases must keep
 * every name a version 1 package may use; removing or renaming one breaks published mods, so it
 * needs a deliberate MOD_API_VERSION bump (and a new pinned catalog here) instead.
 */
test("the version 1 mod contract keeps every name packages may rely on", () => {
  expect(MOD_API_VERSION).toBe(1);
  expect(FACILITY_NAMES).toEqual(
    expect.arrayContaining([
      "Coal",
      "Nuclear",
      "Natural Gas Peaker",
      "Natural Gas CC",
      "Oil",
      "Biomass",
      "Wind",
      "Offshore Wind",
      "Airborne Wind",
      "Solar",
      "Hydro",
      "Geothermal",
      "Enhanced Geothermal",
      "Battery",
      "Pumped Hydro",
    ]),
  );
  expect(MOD_SCENARIO_IDS).toEqual(
    expect.arrayContaining([
      100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115,
    ]),
  );
});
