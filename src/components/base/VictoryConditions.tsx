import * as React from "react";
import { DifficultyType, ScenarioType } from "../../Types";
import { Box, Typography } from "@mui/material";
import { objectiveDefinition } from "../../helpers/ScenarioObjectives";
import {
  objectiveTargetText,
  objectiveWindowText,
} from "../../helpers/ObjectivePresentation";
import { formatLargeMassApprox, KG_PER_MEGATONNE } from "../../helpers/Units";
import { useUnits } from "./UnitsContext";
import { scoreLabel, scoreRuleText } from "../../helpers/Scoring";
import {
  blackoutFiringThreshold,
  formatRequiredShare,
  scenarioObjectiveDefinitions,
} from "../../helpers/ObjectiveRules";

export interface Props {
  scenario: ScenarioType;
  difficulty: DifficultyType;
}

/**
 * How a scenario is scored, in the player's terms. Shared by the scenario details screen and the
 * custom game screen, which both offer it behind an info button.
 *
 * The score rules come from helpers/Scoring `SCORE_RULES`; the Manual describes them by hand.
 */
export default function VictoryConditions(props: Props): React.JSX.Element {
  const { scenario } = props;
  const { ownership, dollarsPerkWh } = scenario;
  const objectives = scenarioObjectiveDefinitions(scenario);
  const units = useUnits();
  const perEmissions = formatLargeMassApprox(KG_PER_MEGATONNE, units);
  const requiredObjectives = (
    <>
      <p>
        In all scenarios, you fail if you go bankrupt or serve less than{" "}
        {formatRequiredShare(blackoutFiringThreshold(props.difficulty))} of
        demand in three consecutive months.
      </p>
      {objectives.length > 0 && (
        <Box component="section" aria-label="Mission objectives">
          {objectives.map((objective) => (
            <Box key={objective.id} sx={{ mt: 2, overflowWrap: "anywhere" }}>
              <Typography component="p" sx={{ fontWeight: 600, mb: 0.5 }}>
                {objective.required ? "Required" : "Optional"}:{" "}
                {objective.label}
              </Typography>
              <Typography
                component="p"
                variant="body2"
                color="text.secondary"
                sx={{ mb: 0.5 }}
              >
                {objectiveDefinition(objective.metric)}
              </Typography>
              <Typography component="p" variant="body2">
                {objectiveTargetText(objective)} ·{" "}
                {objectiveWindowText(
                  objective,
                  scenario.startingYear,
                  scenario.durationMonths,
                )}
              </Typography>
              {!objective.required && (
                <Typography
                  component="p"
                  variant="body2"
                  color="text.secondary"
                >
                  Stretch goal; does not end or fail the run.
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
    </>
  );
  const rules = scoreRuleText(ownership, dollarsPerkWh, perEmissions);
  return (
    <div>
      {requiredObjectives}
      <p>
        Complete the mission to earn a leaderboard rank and a competitive
        personal best. Failed runs still show their points and actual outcomes.
      </p>
      {Object.entries(rules).map(([category, rule]) => (
        <p key={category}>
          <strong>{scoreLabel(category)}:</strong> {rule}
        </p>
      ))}
    </div>
  );
}
