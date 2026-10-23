import fs from "fs";
import path from "path";
import { getScenarioLocation } from "../helpers/Locations";
import { ruleChoices } from "../helpers/ScenarioRuleDependencies";
import { modResolvedSetup, modScenario } from "../mods/ModScenario";
import { validateMod } from "../mods/ModSchema";
import type { DifficultyType } from "../Types";
import { loadSimData } from "./SimData";
import type { SimOptionsType } from "./Simulator";

export const MOD_EXAMPLE_IDS = [
  "funded-or-phased-connection",
  "two-dry-years",
  "retire-coal-without-bill-shock",
] as const;
export type ModExampleId = (typeof MOD_EXAMPLE_IDS)[number];

export function readModExample(id: ModExampleId) {
  return validateMod(
    JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../docs/mods/examples", `${id}.json`),
        "utf8",
      ),
    ),
  );
}

/** Resolve the checked-in package with exactly the same public compiler as a local import. */
export function modExampleScenario(
  id: ModExampleId,
  difficulty: DifficultyType = "Employee",
  seed?: number,
) {
  const pack = readModExample(id);
  if (seed !== undefined) pack.seed = seed;
  const location = getScenarioLocation(modResolvedSetup(pack));
  if (!location)
    throw new Error("The example must resolve a bundled location.");
  loadSimData(location);
  return { pack, scenario: modScenario(pack, undefined, difficulty) };
}

export function modExampleBranches(
  scenario: ReturnType<typeof modExampleScenario>["scenario"],
) {
  return ruleChoices(scenario.mod!.rules).reduce<Record<string, string>[]>(
    (branches, choice) =>
      branches.flatMap((branch) =>
        choice.options.map((option) => ({
          ...branch,
          [choice.key]: option.id,
        })),
      ),
    [{}],
  );
}

/** UI-legal commitments, not a second economic model or an injected winning state. */
export function modExampleRoute(id: ModExampleId): Partial<SimOptionsType> {
  switch (id) {
    case "funded-or-phased-connection":
      return {
        initialBuild: {
          name: "Natural Gas Peaker",
          peakW: 100e6,
          financed: true,
        },
        dollarsPerkWh: 0.12,
      };
    case "two-dry-years":
      return {
        initialBuild: { name: "Oil", peakW: 200e6, financed: true },
        dollarsPerkWh: 0.1,
        scheduledActions: [3, 1, 2].map((facilityId) => ({
          type: "reprioritize",
          month: 0,
          facilityId,
        })),
      };
    case "retire-coal-without-bill-shock":
      return {
        initialBuild: { name: "Natural Gas CC", peakW: 400e6, financed: true },
        scheduledActions: [
          {
            type: "build",
            month: 6,
            build: { name: "Natural Gas CC", peakW: 200e6, financed: false },
          },
          { type: "sell", month: 24, facilityId: 1 },
          { type: "sell", month: 24, facilityId: 2 },
        ],
      };
  }
}
