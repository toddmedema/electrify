import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { getDateFromMinute } from "../../helpers/DateTime";
import { formatMoneyConcise } from "../../helpers/Format";
import { currentTick } from "../../helpers/GameSelectors";
import {
  agreementYearMinute,
  powerAgreementQuote,
} from "../../helpers/PowerAgreements";
import {
  adjacentMarketPricePerMWh,
  intertieContextForGame,
} from "../../helpers/Transmission";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import PowerAgreements, { agreementSummary } from "./PowerAgreements";

function review(temperatureC = 20) {
  const game = createGame({
    scenarioId: 116,
    difficulty: "Employee",
    seed: 12345,
  });
  const minute = agreementYearMinute(2018);
  game.date = getDateFromMinute(minute, game.startingYear);
  for (const tick of game.timeline) tick.minute += minute;
  const now = currentTick(game)!;
  now.temperatureC = temperatureC;
  const line = game.transmission!.lines[0];
  const marketPrice = adjacentMarketPricePerMWh(
    line.corridorId,
    intertieContextForGame(game),
    now.minute,
    now,
  );
  const quote = powerAgreementQuote(game, "champlain-quebec")!;
  const store = configureStore({
    reducer: { game: () => game, ui: uiReducer },
  });
  render(
    <Provider store={store}>
      <PowerAgreements game={game} line={line} />
    </Provider>,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Review Québec hydro replacement",
    }),
  );
  return {
    game,
    line,
    marketPrice,
    quote,
    dialog: screen.getByRole("dialog", {
      name: "Review Québec hydro replacement",
    }),
  };
}

it("uses maximum deliverable coverage consistently without a second capacity figure", () => {
  const { game, line, dialog } = review();
  expect(agreementSummary(game, line.corridorId)).toContain(
    "209MW under agreement",
  );
  expect(
    within(dialog).getByRole("row", { name: /Coverage/ }),
  ).toHaveTextContent("57MW");
  expect(
    within(dialog).getByRole("row", { name: /Coverage/ }),
  ).not.toHaveTextContent("60MW");
  expect(
    within(dialog).getByRole("row", { name: /Payment/ }),
  ).toHaveTextContent("No minimum purchase");
  expect(dialog).not.toHaveTextContent("2005 dollars");
  expect(dialog).not.toHaveTextContent("Local generation can reduce purchases");
});

it.each([
  [20, "above"],
  [-40, "below"],
] as const)(
  "compares today's agreement and actual market rates at %s°C",
  (temperature, direction) => {
    const { dialog, marketPrice, quote } = review(temperature);
    expect(
      direction === "above"
        ? quote.priceToday > marketPrice
        : quote.priceToday < marketPrice,
    ).toBe(true);
    expect(
      within(dialog).getByRole("row", { name: /Price today/ }),
    ).toHaveTextContent(`${formatMoneyConcise(quote.priceToday)}/MWh`);
    const comparison = within(dialog).getByRole("row", {
      name: /Vs market now/,
    });
    expect(comparison).toHaveTextContent(
      `${formatMoneyConcise(marketPrice)}/MWh`,
    );
    expect(comparison).toHaveTextContent(new RegExp(`[0-9.]+% ${direction}`));
  },
);
