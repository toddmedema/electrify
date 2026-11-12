import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import type { PowerAgreementTermsVersion } from "../../Types";
import { getDateFromMinute } from "../../helpers/DateTime";
import { formatNumber } from "../../helpers/Format";
import { currentTick } from "../../helpers/GameSelectors";
import {
  agreementYearMinute,
  powerAgreementQuote,
} from "../../helpers/PowerAgreements";
import {
  adjacentMarketPricePerMWh,
  intertieContextForGame,
} from "../../helpers/Transmission";
import { acceptPowerAgreement } from "../../reducers/GameActions";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import PowerAgreements, { agreementSummary } from "./PowerAgreements";
import { useAgreementForecast } from "./useAgreementForecast";

jest.mock("./useAgreementForecast");
const mockForecast = jest.mocked(useAgreementForecast);
beforeEach(() =>
  mockForecast.mockReturnValue({
    blocked: undefined,
    result: undefined,
    error: false,
    updating: false,
    retry: jest.fn(),
  }),
);
const rate = (value: number) =>
  `$${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/MWh`;
function fixture() {
  const game = createGame({
    scenarioId: 116,
    difficulty: "Employee",
    seed: 12345,
  });
  const minute = agreementYearMinute(2018);
  game.date = getDateFromMinute(minute, game.startingYear);
  for (const tick of game.timeline) tick.minute += minute;
  return game;
}
function mount(game = fixture()) {
  const line = game.transmission!.lines[0];
  const store = configureStore({
    reducer: { game: () => game, ui: uiReducer },
  });
  const dispatch = jest.spyOn(store, "dispatch");
  render(
    <Provider store={store}>
      <PowerAgreements game={game} line={line} />
    </Provider>,
  );
  return { game, line, dispatch };
}
function review(temperatureC = 20) {
  const game = fixture();
  const now = currentTick(game)!;
  now.temperatureC = temperatureC;
  const mounted = mount(game);
  const marketPrice = adjacentMarketPricePerMWh(
    mounted.line.corridorId,
    intertieContextForGame(game),
    now.minute,
    now,
  );
  const quote = powerAgreementQuote(game, "champlain-quebec")!;
  fireEvent.click(
    screen.getByRole("button", { name: "Review Québec hydro replacement" }),
  );
  return {
    ...mounted,
    marketPrice,
    quote,
    dialog: screen.getByRole("dialog", {
      name: "Review Québec hydro replacement",
    }),
  };
}

it("shows exactly the requested six rows with full monthly energy and deliverable power", () => {
  const { game, line, dialog, quote } = review();
  expect(agreementSummary(game, line.corridorId)).toContain(
    "209MW under agreement",
  );
  const table = within(dialog).getByRole("table");
  expect(
    within(table)
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent),
  ).toEqual([
    "Agreement price",
    "Market price",
    "Minimum supply",
    "Maximum supply",
    "Duration",
    "Forecasted savings",
  ]);
  const max = within(table).getByRole("row", { name: /Maximum supply/ });
  expect(max).toHaveTextContent("57 MW");
  expect(max).toHaveTextContent(
    `${formatNumber(quote.maximumMWhPerMonth)} MWh/month`,
  );
  expect(max).not.toHaveTextContent("60 MW");
  expect(
    within(table).getByRole("row", { name: /Minimum supply/ }),
  ).toHaveTextContent(
    `${formatNumber(quote.minimumMWhPerMonth)} MWh/monthPaid for even if you don't use it`,
  );
  expect(
    within(table).getByRole("row", { name: /Duration/ }),
  ).toHaveTextContent("10 yearsEnds Dec 2029");
  expect(dialog).not.toHaveTextContent("Demand served");
  expect(dialog).not.toHaveTextContent("2005 dollars");
  expect(dialog).not.toHaveTextContent("Local generation can reduce purchases");
});

it.each([20, -40])(
  "shows precise agreement and real market prices at %s°C",
  (temperature) => {
    const { dialog, marketPrice, quote } = review(temperature);
    expect(quote.priceToday).toBeLessThan(marketPrice);
    expect(
      within(dialog).getByRole("row", { name: /Agreement price/ }),
    ).toHaveTextContent(`${rate(quote.priceToday)}Follows inflation`);
    const comparison = within(dialog).getByRole("row", {
      name: /Market price/,
    });
    expect(comparison).toHaveTextContent(rate(marketPrice));
    expect(comparison).toHaveTextContent(/[0-9.]+% higher/);
  },
);

it("changes price and end date with duration and signs that exact canonical quote", () => {
  const { game, dialog, quote, dispatch } = review();
  const slider = within(dialog).getByRole("slider", { name: /^Duration/ });
  expect(slider).toHaveAttribute("min", "1");
  expect(slider).toHaveAttribute("max", "10");
  fireEvent.change(slider, { target: { value: "1" } });
  const short = powerAgreementQuote(game, quote.id, 3, 1)!;
  expect(
    within(dialog).getByRole("row", { name: /Agreement price/ }),
  ).toHaveTextContent(rate(short.priceToday));
  expect(short.priceToday).toBeGreaterThan(quote.priceToday);
  expect(
    within(dialog).getByRole("row", { name: /Duration/ }),
  ).toHaveTextContent("1 yearEnds Dec 2020");
  expect(mockForecast).toHaveBeenLastCalledWith(
    game,
    `${short.id}:0`,
    short.receipt,
    true,
  );
  fireEvent.change(slider, { target: { value: "5" } });
  const selected = powerAgreementQuote(game, quote.id, 3, 5)!;
  expect(
    within(dialog).getByRole("row", { name: /Duration/ }),
  ).toHaveTextContent("5 yearsEnds Dec 2024");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Accept agreement" }),
  );
  expect(dispatch).toHaveBeenCalledWith(
    acceptPowerAgreement({
      blockId: selected.id,
      quoteKey: selected.quoteKey,
      durationYears: 5,
    }),
  );
});

it.each([1, 2, 3] as PowerAgreementTermsVersion[])(
  "preserves v%s signed terms and a numeric remaining forecast horizon",
  (version) => {
    const game = fixture();
    game.transmission!.inheritedAgreementTerms = version;
    mockForecast.mockReturnValue({
      blocked: undefined,
      result: { cashDifference: -1234 } as NonNullable<
        ReturnType<typeof useAgreementForecast>["result"]
      >,
      error: false,
      updating: false,
      retry: jest.fn(),
    });
    mount(game);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Forecast Regional nuclear remaining term",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("slider")).not.toBeInTheDocument();
    const minimum = within(dialog).getByRole("row", { name: /Minimum supply/ });
    expect(minimum).toHaveTextContent(
      version === 1
        ? "No minimum purchasePay for energy used"
        : version === 2
          ? "95MW whenever availablePaid for even if you don't use it"
          : "MWh/monthPaid for even if you don't use it",
    );
    expect(
      within(dialog).getByRole("row", { name: /Forecasted savings/ }),
    ).toHaveTextContent(
      "-$1.23k over 2 years remainingBased on current supply and demand",
    );
    expect(
      dialog.textContent?.includes("capped below the current market price"),
    ).toBe(version === 3);
  },
);
