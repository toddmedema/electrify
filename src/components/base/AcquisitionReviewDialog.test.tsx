import { render, screen, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { UTILITY_TARGETS } from "../../data/UtilityExpansion";
import { acquisitionQuote } from "../../helpers/Expansion";
import { currentTick } from "../../helpers/GameSelectors";
import { formatMoneyConcise, formatWatts } from "../../helpers/Format";
import { copyOfficialGame } from "../../testing/OfficialScenarioExecutionFixtures";
import { createGame } from "../../testing/Simulator";
import { buildTransmissionLine } from "../../reducers/Game";
import reducer from "../../reducers/Game";
import uiReducer from "../../reducers/UI";
import { UtilityTargetId } from "../../Types";
import AcquisitionReviewDialog from "./AcquisitionReviewDialog";

function review(targetId: UtilityTargetId) {
  const initial = createGame({
    scenarioId: 116,
    seed: 12345,
    difficulty: "Employee",
  });
  currentTick(initial)!.cash = 2e9;
  const game = copyOfficialGame(
    reducer(
      initial,
      buildTransmissionLine({
        corridorId: UTILITY_TARGETS.find((target) => target.id === targetId)!
          .corridorId,
        financed: false,
      }),
    ),
  );
  game.transmission!.lines[0].yearsToBuildLeft = 0;
  const quote = acquisitionQuote(game, targetId)!;
  const store = configureStore({
    reducer: { game: () => game, ui: uiReducer },
  });
  render(
    <Provider store={store}>
      <AcquisitionReviewDialog
        game={game}
        targetId={targetId}
        onClose={jest.fn()}
        onAcquire={jest.fn()}
      />
    </Provider>,
  );
  return quote;
}

function fact(label: string) {
  return screen.getByText(label).closest(".decisionImpactFact") as HTMLElement;
}

it.each(["valley-electric", "ridge-electric"] as const)(
  "shows the full upfront and monthly debt/network acquisition costs once for %s",
  (targetId) => {
    const quote = review(targetId);
    const cash = within(fact("Cash purchase"));
    const loan = within(fact("Loan option"));
    expect(cash.getByText(/upfront/, { selector: "strong" })).toHaveTextContent(
      `${formatMoneyConcise(quote.cashDue)} upfront + ${formatMoneyConcise(quote.cashMonthlyDebtService + quote.networkOMPerMonth)}/mo`,
    );
    expect(loan.getByText(/upfront/, { selector: "strong" })).toHaveTextContent(
      `${formatMoneyConcise(quote.financedCashDue)} upfront + ${formatMoneyConcise(quote.monthlyDebtService + quote.networkOMPerMonth)}/mo`,
    );
    expect(cash.getByText(/assumed debt/)).toHaveTextContent("5% for 20 years");
    expect(loan.getByText(/New loan/)).toHaveTextContent("30 years");
    expect(screen.queryByText(/fee included/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Plant operations and purchased power vary/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Acquire either utility by December 2014/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Projected month-end cash with financing"),
    ).not.toBeInTheDocument();
    const plants = within(fact("Operating plants")).getByText(/years old/);
    expect(plants.textContent?.split("\n")).toEqual(
      [...quote.facilities]
        .sort((a, b) => b.peakW - a.peakW)
        .map(
          (plant) =>
            `${plant.name} ${formatWatts(plant.peakW)} · ${plant.ageYears.toFixed(1)} years old`,
        ),
    );
    expect(screen.queryByText("Seller equity price")).not.toBeInTheDocument();
    expect(screen.queryByText("Assumed debt")).not.toBeInTheDocument();
    expect(screen.queryByText("Service-network costs")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Combined debt payments with financing"),
    ).not.toBeInTheDocument();
  },
);

it("keeps Valley's dated supply reduction with acquisition obligations", () => {
  review("valley-electric");
  const obligations = within(fact("Acquisition obligations"));
  expect(obligations.getByText(/January 2017/)).toHaveTextContent(
    "160MW to 80MW",
  );
  expect(obligations.getByText(/January 2017/)).toHaveTextContent(
    "152MW to 76MW deliverable",
  );
  expect(screen.queryByText(/Plan replacement supply/)).not.toBeInTheDocument();
});
