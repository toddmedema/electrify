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
