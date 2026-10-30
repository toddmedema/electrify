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
  reliabilityRuleText,
  scenarioObjectiveDefinitions,
} from "../../helpers/ObjectiveRules";

export interface Props {
  scenario: ScenarioType;
  difficulty: DifficultyType;
}

/** Requirements lead; canonical scoring rules and measurement help stay separate. */
export default function VictoryConditions({
  scenario,
  difficulty,
}: Props): React.JSX.Element {
  const objectives = scenarioObjectiveDefinitions(scenario);
  const units = useUnits();
  const rules = scoreRuleText(
    scenario.ownership,
    scenario.dollarsPerkWh,
    formatLargeMassApprox(KG_PER_MEGATONNE, units),
  );
  const requirementsId = React.useId();
  const optionalId = React.useId();
  const scoringId = React.useId();
  const required = objectives.filter((objective) => objective.required);
  const optional = objectives.filter((objective) => !objective.required);
  const objectiveRows = (goals: typeof objectives) => (
    <ul className="victoryObjectiveList">
      {goals.map((objective) => (
        <li key={objective.id}>
          <Typography component="p" variant="body2" sx={{ fontWeight: 600 }}>
            {objective.label}
          </Typography>
          <Typography component="p" variant="body2" color="textSecondary">
            {objectiveTargetText(objective)} ·{" "}
            {objectiveWindowText(
              objective,
              scenario.startingYear,
              scenario.durationMonths,
            )}
          </Typography>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="victoryConditions">
      <Box component="section" aria-labelledby={requirementsId}>
        <Typography
          id={requirementsId}
          component="h2"
          variant="subtitle1"
          sx={{ fontWeight: 600 }}
        >
          Requirements
        </Typography>
        <ul className="victorySurvivalList">
          <li>Finish the term without bankruptcy.</li>
          <li>{reliabilityRuleText(difficulty)}</li>
        </ul>
        {required.length > 0 && objectiveRows(required)}
      </Box>

      {optional.length > 0 && (
        <Box component="section" aria-labelledby={optionalId}>
          <Typography
            id={optionalId}
            component="h2"
            variant="subtitle1"
            sx={{ fontWeight: 600 }}
          >
            Optional goals
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Stretch goals; not required to win.
          </Typography>
          {objectiveRows(optional)}
        </Box>
      )}

      <Box
        component="section"
        className="victoryScoring"
        aria-labelledby={scoringId}
      >
        <Typography
          id={scoringId}
          component="h2"
          variant="subtitle1"
          sx={{ fontWeight: 600 }}
        >
          Scoring
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Complete the mission to rank on the leaderboard.
        </Typography>
        <dl className="victoryScoringRules">
          {Object.entries(rules).map(([category, rule]) => (
            <div key={category}>
              <dt>{scoreLabel(category)}</dt>
              <dd>{rule}</dd>
            </div>
          ))}
        </dl>
      </Box>

      {objectives.length > 0 && (
        <details className="victoryMeasurementHelp">
          <summary>How objectives are measured</summary>
          <dl>
            {objectives.map((objective) => (
              <div key={objective.id}>
                <dt>{objective.label}</dt>
                <dd>{objectiveDefinition(objective.metric)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
