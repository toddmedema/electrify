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
  "prepare-before-freeze",
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
  pack.seed = seed ?? pack.seed;
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
export function modExampleRoute(
  id: ModExampleId,
  responses: Record<string, string> = {},
): Partial<SimOptionsType> {
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
    case "prepare-before-freeze":
      return {
        initialBuild: {
          name: "Natural Gas Peaker",
          peakW: 3000e6,
          financed: true,
        },
        dollarsPerkWh: 0.091,
        scheduledActions: [
          ...[1, 3, 5].map((facilityId) => ({
            type: "reprioritize" as const,
            month: 0,
            facilityId,
          })),
          {
            type: "build",
            month: 24,
            build: {
              name: "Natural Gas Peaker",
              peakW: Object.values(responses).includes("winterize")
                ? 1000e6
                : 1500e6,
              financed: false,
            },
          },
        ],
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
