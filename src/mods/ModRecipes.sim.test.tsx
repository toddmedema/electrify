import { createModRecipes, createAuthoringTemplate } from "./ModRecipes";
import { validateMod } from "./ModSchema";
import { modScenario, modResolvedSetup } from "./ModScenario";
import { runSimulation } from "../testing/Simulator";
import { loadSimData } from "../testing/SimData";
import { getScenarioLocation } from "../helpers/Locations";
import { ruleChoices } from "../helpers/ScenarioRuleDependencies";

for (const [name, input] of Object.entries({
  ...createModRecipes(),
  template: createAuthoringTemplate(),
})) {
  test(`executable ${name} recipe compiles and simulates every consequential branch`, () => {
    const pack = validateMod(input);
    const location = getScenarioLocation(modResolvedSetup(pack));
    if (!location) throw new Error("Recipe requires bundled location");
    loadSimData(location);
    const scenario = modScenario(pack, undefined, "Employee");
    const choices = ruleChoices(scenario.mod!.rules);
    const branches = choices.length
      ? choices[0].options.map((option) => ({ [choices[0].key]: option.id }))
      : [{}];
    for (const scenarioResponses of branches) {
      const result = runSimulation({
        scenarioId: 999,
        scenario,
        difficulty: "Employee",
        seed: pack.seed,
        months: scenario.durationMonths,
        scenarioResponses,
        scenarioResponseMode: "strict",
      });
      expect(result.violations).toEqual([]);
      expect(result.months).toHaveLength(scenario.durationMonths);
      expect(result.outcome).toBe("completed");
      for (const [key, option] of Object.entries(scenarioResponses))
        expect(result.storyOccurrences).toContainEqual(
          expect.objectContaining({
            key,
            attributes: expect.objectContaining({
              choice: option,
              scenarioChoice: true,
            }),
          }),
        );
    }
  });
}
