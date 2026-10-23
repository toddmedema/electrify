import fs from "fs";
import path from "path";
import { getScenarioLocation } from "../helpers/Locations";
import { loadSimData } from "../testing/SimData";
import { modResolvedSetup, modScenario } from "./ModScenario";
import { validateMod } from "./ModSchema";

test("only the arc-import example depends on official scenario rules", () => {
  const directory = path.resolve(__dirname, "../../docs/mods/examples");
  const examples = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const pack = validateMod(
        JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")),
      );
      const location = getScenarioLocation(modResolvedSetup(pack));
      if (!location) throw new Error(`Missing example location: ${pack.id}`);
      loadSimData(location);
      return {
        pack,
        rules: modScenario(pack, undefined, "Employee").mod!.rules,
      };
    });
  expect(
    examples
      .filter(
        ({ rules }) => rules.arcEvents?.length || rules.arcChoices?.length,
      )
      .map(({ pack }) => pack.id),
  ).toEqual(["funded-or-phased-connection"]);
  for (const { pack, rules } of examples.filter(
    ({ pack }) => pack.id !== "funded-or-phased-connection",
  )) {
    expect(pack.officialArcs).toEqual([]);
    expect(pack.objectives.mode).toBe("replace");
    expect(rules.objectives.length).toBeGreaterThan(0);
  }
});
