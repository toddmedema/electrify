import * as React from "react";
import { connect } from "react-redux";
import { AppStateType } from "../../Types";
import TutorialPrompt from "./TutorialPrompt";

function CustomerGrowthChallenge({
  startingCustomers,
}: {
  startingCustomers: number;
}) {
  return (
    <TutorialPrompt
      concepts={["rate", "customers", "money"]}
      text={`Your turn: reach at least ${Math.ceil(startingCustomers * 1.05).toLocaleString("en-US")} customers (5% above the starting ${startingCustomers.toLocaleString("en-US")}) in six months while staying profitable and reliable.`}
    />
  );
}

// Authored scenarios import this component during reducer initialization. Avoid importing Store
// (including its hooks) across that boundary; the connection reads state only when rendered.
export default connect((state: AppStateType) => ({
  startingCustomers: state.game.customerMarketSize / 2,
}))(CustomerGrowthChallenge);
