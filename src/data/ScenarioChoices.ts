import type { ScenarioChoiceType } from "../Types";
import { ruleNumber } from "../helpers/ScenarioRules";
import { catalogChoiceKey, SCENARIO_CHOICE_RULES } from "./ScenarioChoiceRules";

export {
  DATA_CENTER_DECISION_KEY,
  DATA_CENTER_GRANT,
} from "./ScenarioChoiceRules";

/** Transitional presentation adapter. The owning challenge choices themselves are plain data. */
export const SCENARIO_CHOICES: ScenarioChoiceType[] = SCENARIO_CHOICE_RULES.map(
  (entry) => ({
    id: catalogChoiceKey(entry),
    scenarioId: entry.scenarioId,
    atMonth: entry.choice.dueMonth - 1,
    title: entry.choice.title,
    message: entry.choice.prompt,
    options: entry.choice.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
      message: option.message,
      cost: (difficulty) => ruleNumber(option.costDollars ?? 0, difficulty),
      ...(option.grantDollars !== undefined
        ? {
            upfrontGrant: (difficulty) =>
              ruleNumber(option.grantDollars!, difficulty),
          }
        : {}),
      ...(option.meaningful === false ? { meaningful: false } : {}),
      ...(option.replaceLoad
        ? {
            loadAdditions: option.replaceLoad.with.map((load) => ({
              id: load.id,
              label: load.demandType,
              startsYear: 2020 + Math.floor((load.startMonth - 1) / 12),
              peakW: (load.peakMW ?? 0) * 1e6,
              loadFactor: load.loadFactor,
              demandType: load.demandType,
              ...(load.supplementsBackground === undefined
                ? {}
                : { supplementsBackground: load.supplementsBackground }),
            })),
          }
        : {}),
    })),
  }),
);
