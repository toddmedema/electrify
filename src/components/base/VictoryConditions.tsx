import * as React from "react";
import { ScenarioType } from "../../Types";
import { formatLargeMassApprox, KG_PER_MEGATONNE } from "../../helpers/Units";
import { useUnits } from "./UnitsContext";

export interface Props {
  ownership: ScenarioType["ownership"];
  dollarsPerkWh: number;
  minimumCustomerRetention?: number;
  reliabilityObjective?: ScenarioType["reliabilityObjective"];
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
  if (ownership === "Investor") {
    return (
      <div>
        <p>+40 pts per $1B of net worth at the end</p>
        <p>+2 pts per 100k customers at the end</p>
        <p>+1 pt per TWh of electricity supplied</p>
        <p>-2 pts per {perEmissions} of greenhouse gas emissions</p>
        <p>-8 pts per TWh of blackouts</p>
      </div>
    );
  }
  return (
    <div>
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
        </p>
      )}
      <p>
        +/-80 pts per lifetime average $0.01/kWh charged above/below $
        {dollarsPerkWh}/kWh
      </p>
      <p>+10 pts per TWh of electricity supplied</p>
      <p>-5 pts per {perEmissions} of greenhouse gas emissions</p>
      <p>-10 pts per TWh of blackouts</p>
    </div>
  );
}
