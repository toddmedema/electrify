import * as React from "react";
import {
  DifficultyType,
  MeaningfulDecisionType,
  ScenarioType,
} from "../../Types";
import { formatLargeMassApprox, KG_PER_MEGATONNE } from "../../helpers/Units";
import { useUnits } from "./UnitsContext";
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
 * Scoring algorithm should also be updated in helpers/Scoring.tsx and in the Manual.
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
          {Math.round(reliabilityObjective.minimumDemandServed * 100)}% of
          demand during the {reliabilityObjective.label}
          {(reliabilityObjective.durationMonths || 1) > 1
            ? " in every event month"
            : ""}
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
  if (ownership === "Investor") {
    return (
      <div>
        {decisionProgress}
        {requiredObjectives}
        <p>Earn 40 points per $1 billion of net worth at the end.</p>
        <p>Earn 2 points per 100,000 customers at the end.</p>
        <p>Earn 1 point per terawatt-hour (TWh) of electricity supplied.</p>
        <p>Lose 2 points per {perEmissions} of greenhouse gas emissions.</p>
        <p>Lose 8 points per TWh of customer demand not served.</p>
      </div>
    );
  }
  return (
    <div>
      {decisionProgress}
      {requiredObjectives}
      <p>
        Earn 80 points for each $0.01/kWh your lifetime average rate is below
        the ${dollarsPerkWh}/kWh target.
      </p>
      <p>
        Lose 80 points for each $0.01/kWh your lifetime average rate is above
        the target.
      </p>
      <p>Earn 10 points per terawatt-hour (TWh) of electricity supplied.</p>
      <p>Lose 5 points per {perEmissions} of greenhouse gas emissions.</p>
      <p>Lose 10 points per TWh of customer demand not served.</p>
    </div>
  );
}
