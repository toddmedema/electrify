import * as React from "react";
import { formatNumber } from "../../helpers/Format";
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
      text={`Reach at least ${formatNumber(Math.ceil(startingCustomers * 1.05))} customers (5% above the starting ${formatNumber(startingCustomers)}) in six months. Offer a modest discount below market, cover expenses and keep supply above demand.`}
    />
  );
}

// Authored scenarios import this component during reducer initialization. Avoid importing Store
// (including its hooks) across that boundary; the connection reads state only when rendered.
export default connect((state: AppStateType) => ({
  startingCustomers: state.game.customerMarketSize / 2,
}))(CustomerGrowthChallenge);
