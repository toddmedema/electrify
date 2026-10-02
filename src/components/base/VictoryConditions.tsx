import * as React from "react";
import { ScenarioType } from "../../Types";
import { formatLargeMassApprox, KG_PER_MEGATONNE } from "../../helpers/Units";
import { useUnits } from "./UnitsContext";
import { scoreRuleText } from "../../helpers/Scoring";
import { formatRequiredShare } from "../../helpers/ObjectiveRules";

export interface Props {
  ownership: ScenarioType["ownership"];
  dollarsPerkWh: number;
  startingCustomers?: number;
  minimumCustomerRetention?: number;
  reliabilityObjective?: ScenarioType["reliabilityObjective"];
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
  const requiredObjectives = (
    <>
      <p>
        In all scenarios, you fail if you go bankrupt or serve less than 90% of
        demand in three consecutive months.
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
      {requiredObjectives}
      {Object.entries(rules).map(([category, rule]) => (
        <p key={category}>{rule}</p>
      ))}
    </div>
  );
}
