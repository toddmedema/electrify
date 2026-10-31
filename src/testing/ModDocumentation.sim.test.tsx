import fs from "fs";
import path from "path";
import { validateMod } from "../mods/ModSchema";
import { modResolvedSetup, modScenario } from "../mods/ModScenario";
import { loadSimData } from "./SimData";
import { getScenarioLocation } from "../helpers/Locations";
import { runSimulation } from "./Simulator";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";

const input = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../docs/mods/worked-timeline.json"),
    "utf8",
  ),
);

test.each(["maintain", "upgrade", "subsidize"])(
  "the documented months 12–25 timeline executes its %s branch under the shared reliability rule",
  (optionId) => {
    const pack = validateMod(input);
    const location = getScenarioLocation(modResolvedSetup(pack));
    if (!location)
      throw new Error("The worked example needs its bundled location.");
    loadSimData(location);
    const scenario = modScenario(pack, undefined, "Employee");
    const result = runSimulation({
      scenarioId: 999,
      scenario,
      seed: pack.seed,
      difficulty: "Employee",
      scenarioResponseMode: "strict",
      scenarioResponses: { "mod:worked-timeline:grid-plan": optionId },
    });
    expect(result.violations).toEqual([]);
    expect(result.outcome).toBe("completed");
    expect(result.months).toHaveLength(25);
    expect(result.objectiveResults).toEqual([]);
    const choice = result.storyOccurrences.find(
      (event) => event.key === "mod:worked-timeline:grid-plan",
    );
    expect(choice?.attributes.choice).toBe(optionId);
    const effect = result.storyOccurrences.find(
      (event) => event.key === "mod:worked-timeline:new-demand",
    );
    expect(
      effect && {
        multiplier: effect.effects.demandMultiplier,
        startsMinute: effect.startsMinute,
        endsMinute: effect.endsMinute,
      },
    ).toEqual(
      optionId === "maintain"
        ? undefined
        : {
            multiplier: 1.1,
            startsMinute: 12 * MINUTES_PER_MONTH,
            endsMinute: 25 * MINUTES_PER_MONTH,
          },
    );
  },
);
