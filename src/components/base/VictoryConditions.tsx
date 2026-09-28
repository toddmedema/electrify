import * as React from "react";
import {
  DifficultyType,
  MeaningfulDecisionType,
  ScenarioType,
} from "../../Types";
import { formatLargeMassApprox, KG_PER_MEGATONNE } from "../../helpers/Units";
import { useUnits } from "./UnitsContext";
import { scoreRuleText } from "../../helpers/Scoring";
import { formatRequiredShare } from "../../helpers/ObjectiveRules";
import {
  meaningfulDecisionCategoryCount,
  meaningfulDecisionRequirement,
  MEANINGFUL_DECISION_CATEGORY_LABELS,
} from "../../helpers/MeaningfulDecisions";

export interface Props {
  ownership: ScenarioType["ownership"];
  dollarsPerkWh: number;
  startingCustomers?: number;
  minimumCustomerRetention?: number;
  reliabilityObjective?: ScenarioType["reliabilityObjective"];
  difficulty?: DifficultyType;
  meaningfulDecisions?: MeaningfulDecisionType[];
  meaningfulDecisionGateWaived?: boolean;
}

/**
 * How a scenario is scored, in the player's terms. Shared by the scenario details screen and the
 * custom game screen, which both offer it behind an info button.
 *
 * The score rules come from helpers/Scoring `SCORE_RULES`; the Manual describes them by hand.
 */
export default function VictoryConditions(props: Props): React.JSX.Element {
  const {
    ownership,
    dollarsPerkWh,
    minimumCustomerRetention,
    reliabilityObjective,
  } = props;
  const units = useUnits();
  const perEmissions = formatLargeMassApprox(KG_PER_MEGATONNE, units);
  const decisions = props.meaningfulDecisions ?? [];
  const requirement = props.difficulty
    ? meaningfulDecisionRequirement(props.difficulty)
    : null;
  const decisionProgress = requirement ? (
    <div data-testid="meaningful-decision-progress">
      {props.meaningfulDecisionGateWaived ? (
        <p>
          This game began before decision tracking was added, so its original
          victory rules still apply.
        </p>
      ) : (
        <>
          <p>
            Required: make {requirement.count} meaningful decision
            {requirement.count === 1 ? "" : "s"} that change the grid or its
            economics
            {requirement.categories > 1
              ? ` across at least ${requirement.categories} decision types`
              : ""}
            . Progress: {decisions.length} of {requirement.count}
            {requirement.categories > 1
              ? ` choices · ${meaningfulDecisionCategoryCount(decisions)} of ${requirement.categories} types`
              : ""}
            .
          </p>
          <p>
            Decision counts are learning goals for this game, not a real utility
            standard. Meeting a score target does not waive required objectives.
          </p>
          {decisions.length > 0 && (
            <ul data-testid="meaningful-decision-history">
              {decisions.map((decision) => (
                <li key={decision.key}>
                  {decision.label} —{" "}
                  {MEANINGFUL_DECISION_CATEGORY_LABELS[decision.kind]}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  ) : null;
  const requiredObjectives = (
    <>
      <p>
        Regular scenarios end early if cash is negative at a month-end check, or
        if less than 90% of demand is served in each of three consecutive
        completed months. These are game failure rules, not regulatory
        standards.
      </p>
      {reliabilityObjective !== undefined && (
        <p>
          Required: serve at least{" "}
          {formatRequiredShare(reliabilityObjective.minimumDemandServed)} of
          demand during the {reliabilityObjective.label}
          {(reliabilityObjective.durationMonths || 1) > 1
            ? " in every event month"
            : ""}
          . A month below target ends the run.
        </p>
      )}
      {minimumCustomerRetention !== undefined && (
        <p>
          Required: retain at least {Math.round(minimumCustomerRetention * 100)}
          % of starting customers
          {props.startingCustomers !== undefined &&
            ` (at least ${Math.ceil(props.startingCustomers * minimumCustomerRetention).toLocaleString("en-US")} customers, from ${props.startingCustomers.toLocaleString("en-US")} at the start)`}
        </p>
      )}
    </>
  );
  const rules = scoreRuleText(ownership, dollarsPerkWh, perEmissions);
  return (
    <div>
      {decisionProgress}
      {requiredObjectives}
      {Object.entries(rules).map(([category, rule]) => (
        <p key={category}>{rule}</p>
      ))}
    </div>
  );
}
