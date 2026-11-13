import { fireEvent, render, screen, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { createGame } from "../../testing/Simulator";
import { acquireUtility } from "../../reducers/GameActions";
import reducer, {
  buildTransmissionLine,
  generateForecastTimeline,
} from "../../reducers/Game";
import { acquisitionQuote, utilityOffer } from "../../helpers/Expansion";
import { formatMoneyConcise } from "../../helpers/Format";
import { currentTick } from "../../helpers/GameSelectors";
import { copyOfficialGame } from "../../testing/OfficialScenarioExecutionFixtures";
import { UTILITY_TARGETS } from "../../data/UtilityExpansion";
import UtilityOfferDialog from "./UtilityOfferDialog";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";

it.each(["valley-electric", "ridge-electric"])(
  "quotes the fee-inclusive price and complete monthly costs for %s",
  (targetId) => {
    const game = createGame({
      scenarioId: 116,
      difficulty: "Employee",
      seed: 12345,
    });
    const offer = utilityOffer(game, targetId)!;
    const store = configureStore({
      reducer: { game: reducer },
      preloadedState: { game },
    });
    render(
      <Provider store={store}>
        <UtilityOfferDialog
          game={game}
          targetId={targetId}
          onClose={jest.fn()}
        />
      </Provider>,
    );
    const price = screen.getByRole("row", { name: /^Price / });
    expect(within(price).getByRole("cell")).toHaveTextContent(
      formatMoneyConcise(offer.cashDue),
    );
    expect(
      within(
        screen.getByRole("row", { name: /^Monthly cost · cash / }),
      ).getByRole("cell"),
    ).toHaveTextContent(
      `${formatMoneyConcise(offer.cashMonthlyDebtService + offer.networkOMPerMonth)}/mo`,
    );
    expect(
      within(
        screen.getByRole("row", { name: /^Monthly cost · loan / }),
      ).getByRole("cell"),
    ).toHaveTextContent(
      `${formatMoneyConcise(offer.monthlyDebtService + offer.networkOMPerMonth)}/mo`,
    );
    expect(
      within(
        screen.getByRole("row", { name: /^Loan down payment / }),
      ).getByRole("cell"),
    ).toHaveTextContent(formatMoneyConcise(offer.financedCashDue));
    for (const name of [
      "Equity price + fee",
      "Cash purchase",
      "Your cash",
      "Cash covers today’s offer",
    ]) {
      expect(screen.queryByRole("rowheader", { name })).not.toBeInTheDocument();
    }
  },
);

it.each([
  ["valley-electric", "2.2TWh", "406MW"],
  ["ridge-electric", "1TWh", "160MW"],
])(
  "shows dated seller demand before a connection to %s",
  (targetId, energy, peak) => {
    const game = createGame({
      scenarioId: 116,
      difficulty: "Employee",
      seed: 12345,
    });
    const store = configureStore({
      reducer: { game: reducer },
      preloadedState: { game },
    });
    render(
      <Provider store={store}>
        <UtilityOfferDialog
          game={game}
          targetId={targetId}
          onClose={jest.fn()}
        />
      </Provider>,
    );
    fireEvent.click(screen.getByText("Demand reference · January 2005"));
    expect(
      screen.getByText(
        new RegExp(`${energy} annual delivered energy · ${peak} peak demand`),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Historical baseline/)).toHaveTextContent(
      "Utility peaks do not add",
    );
    expect(
      screen.queryByRole("button", { name: /Pay cash|Take loan/ }),
    ).not.toBeInTheDocument();
  },
);

it("keeps a disappeared offer visible and cancellable so its pause token can close", () => {
  let game = createGame({
    scenarioId: 116,
    difficulty: "Employee",
    seed: 12345,
  });
  currentTick(game)!.cash = 2e9;
  game = copyOfficialGame(
    reducer(
      game,
      buildTransmissionLine({
        corridorId: UTILITY_TARGETS[0].corridorId,
        financed: false,
      }),
    ),
  );
  game.transmission!.lines.find(
    (line) => line.corridorId === "vt-champlain-valley",
  )!.yearsToBuildLeft = 0;
  const quote = acquisitionQuote(game, "valley-electric")!;
  game.speed = "NORMAL";
  const store = configureStore({
    reducer: { game: reducer },
    preloadedState: { game },
  });
  const onClose = jest.fn();
  const view = render(
    <Provider store={store}>
      <UtilityOfferDialog
        game={game}
        targetId="valley-electric"
        onClose={onClose}
      />
    </Provider>,
  );
  expect(store.getState().game.policyPause?.token).toBe(
    "company-terms:valley-electric",
  );
  const acquired = reducer(
    game,
    acquireUtility({
      targetId: "valley-electric",
      financed: false,
      quoteKey: quote.quoteKey,
    }),
  );
  view.rerender(
    <Provider store={store}>
      <UtilityOfferDialog
        game={acquired}
        targetId="valley-electric"
        onClose={onClose}
      />
    </Provider>,
  );
  expect(
    screen.getByRole("dialog", { name: "Acquisition terms unavailable" }),
  ).toBeVisible();
  expect(store.getState().game.policyPause?.token).toBe(
    "company-terms:valley-electric",
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to connections" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(store.getState().game.policyPause).toBeUndefined();
  expect(store.getState().game.speed).toBe("NORMAL");
});

function reviewYear(year: number) {
  const game = createGame({
    scenarioId: 116,
    difficulty: "Employee",
    seed: 12345,
  });
  game.date = getDateFromMinute(
    (year - game.startingYear) * 12 * MINUTES_PER_MONTH,
    game.startingYear,
  );
  game.timeline = generateForecastTimeline(game, 2e9, 90000, 2);
  const store = configureStore({
    reducer: { game: reducer },
    preloadedState: { game },
  });
  render(
    <Provider store={store}>
      <UtilityOfferDialog
        game={game}
        targetId="valley-electric"
        onClose={jest.fn()}
      />
    </Provider>,
  );
}

it.each([2017, 2024])(
  "shows current Valley nuclear rights from the dated offer in %i",
  (year) => {
    reviewYear(year);
    expect(screen.getByText(/nuclear purchase is now/)).toHaveTextContent(
      "76MW deliverable",
    );
  },
);

it("describes Valley nuclear rights as expired after 2024", () => {
  reviewYear(2025);
  expect(screen.getByText(/nuclear purchase has expired/)).toBeInTheDocument();
  expect(screen.queryByText(/nuclear purchase is now/)).not.toBeInTheDocument();
  expect(
    screen.getByText("No inherited purchased-power rights remain."),
  ).toBeInTheDocument();
});
