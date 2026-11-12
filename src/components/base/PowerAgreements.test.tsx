import { configureStore } from "@reduxjs/toolkit";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Provider, useSelector } from "react-redux";
import type { GameType, PowerAgreementTermsVersion } from "../../Types";
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
import {
  acceptPowerAgreement,
  multiplayerSnapshot,
} from "../../reducers/GameActions";
import gameReducer from "../../reducers/Game";
import cardReducer from "../../reducers/Card";
import settingsReducer from "../../reducers/Settings";
import userReducer from "../../reducers/User";
import {
  multiplayerMiddleware,
  registerMultiplayerRuntime,
} from "../../multiplayer/Registry";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import PowerAgreements, { agreementSummary } from "./PowerAgreements";
import { useAgreementForecast } from "./useAgreementForecast";

jest.mock("./useAgreementForecast");
const mockForecast = jest.mocked(useAgreementForecast);
afterEach(() => registerMultiplayerRuntime(undefined));
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
    reducer: {
      game: gameReducer,
      ui: uiReducer,
      card: cardReducer,
      settings: settingsReducer,
      user: userReducer,
    },
    preloadedState: { game },
    middleware: (getDefault) => getDefault().concat(multiplayerMiddleware),
  });
  const dispatch = jest.spyOn(store, "dispatch");
  function ConnectedAgreements() {
    const state = useSelector((state: { game: GameType }) => state.game);
    return <PowerAgreements game={state} line={state.transmission!.lines[0]} />;
  }
  render(
    <Provider store={store}>
      <ConnectedAgreements />
    </Provider>,
  );
  return { game, line, dispatch, store };
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

it("shows the direct discount alongside monthly energy and deliverable power", () => {
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
    "Discount",
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
  expect(dialog).not.toHaveTextContent("The price follows inflation");
  expect(
    within(dialog).getByRole("slider", { name: "Duration" }),
  ).toBeVisible();
  expect(
    within(dialog).queryByText("Duration", {
      selector: ".powerAgreementDuration .MuiTypography-root",
    }),
  ).not.toBeInTheDocument();
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
    expect(comparison).not.toHaveTextContent("higher");
    expect(
      within(dialog).getByRole("row", { name: /^Discount/ }),
    ).toHaveTextContent("20%");
  },
);

it("changes price and end date with duration and signs that exact canonical quote", () => {
  const { game, dialog, quote, dispatch, store } = review();
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
    within(dialog).getByRole("row", { name: /^Discount/ }),
  ).toHaveTextContent("1%");
  expect(
    within(dialog).getByRole("row", { name: /Duration/ }),
  ).toHaveTextContent("1 yearEnds Dec 2020");
  expect(mockForecast).toHaveBeenLastCalledWith(
    store.getState().game,
    `${short.id}:0`,
    short.receipt,
    true,
  );
  fireEvent.change(slider, { target: { value: "5" } });
  const selected = powerAgreementQuote(game, quote.id, 3, 5)!;
  expect(
    within(dialog).getByRole("row", { name: /^Discount/ }),
  ).toHaveTextContent("9.4%");
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

function sharedReview() {
  const game = fixture();
  game.multiplayer = { seat: "self" };
  const submit = jest.fn<Promise<void>, [unknown]>();
  registerMultiplayerRuntime({
    command: jest.fn(),
    submit,
    activity: jest.fn(),
    leave: jest.fn(),
  });
  const mounted = mount(game);
  fireEvent.click(
    screen.getByRole("button", { name: "Review Québec hydro replacement" }),
  );
  const dialog = screen.getByRole("dialog");
  const accept = within(dialog).getByRole("button", {
    name: "Accept agreement",
  });
  return { ...mounted, submit, dialog, accept };
}

it("keeps co-op acceptance pending until the host records and acknowledges the agreement", async () => {
  const { game, store, submit, dialog, accept } = sharedReview();
  let acknowledge!: () => void;
  submit.mockReturnValue(
    new Promise<void>((resolve) => {
      acknowledge = resolve;
    }),
  );
  const quote = powerAgreementQuote(game, "champlain-quebec")!;
  fireEvent.click(accept);
  expect(dialog).toBeVisible();
  expect(store.getState().ui.snackbar.message).not.toMatch(
    /Agreement accepted/,
  );
  expect(submit).toHaveBeenCalledWith({
    kind: "action",
    name: "acceptPowerAgreement",
    payload: {
      blockId: quote.id,
      quoteKey: quote.quoteKey,
      durationYears: quote.durationYears,
    },
  });
  expect(accept).toBeDisabled();
  expect(within(dialog).getByRole("slider")).toBeDisabled();
  expect(
    store.getState().game.transmission!.acceptedAgreements ?? [],
  ).toHaveLength(0);
  act(() => {
    store.dispatch(
      multiplayerSnapshot(
        gameReducer(
          store.getState().game,
          acceptPowerAgreement({
            blockId: quote.id,
            quoteKey: quote.quoteKey,
            durationYears: quote.durationYears,
          }),
        ),
      ),
    );
  });
  expect(dialog).toBeVisible();
  expect(store.getState().ui.snackbar.message).not.toMatch(
    /Agreement accepted/,
  );
  await act(async () => acknowledge());
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(store.getState().ui.snackbar.message).toMatch(/Agreement accepted/);
  expect(store.getState().game.transmission!.acceptedAgreements).toHaveLength(
    1,
  );
});

it("does not report success for a co-op acknowledgement without a recorded agreement", async () => {
  const { store, submit, dialog, accept } = sharedReview();
  submit.mockResolvedValue(undefined);
  fireEvent.click(accept);
  await waitFor(() =>
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /Agreement terms changed/,
    ),
  );
  expect(dialog).toBeVisible();
  expect(accept).toBeEnabled();
  expect(store.getState().ui.snackbar.message).not.toMatch(
    /Agreement accepted/,
  );
});

it("keeps a rejected co-op quote recoverable and submits the refreshed host terms on retry", async () => {
  const { game, store, submit, dialog, accept } = sharedReview();
  let reject!: (error: Error) => void;
  submit.mockReturnValueOnce(
    new Promise<void>((_resolve, fail) => {
      reject = fail;
    }),
  );
  fireEvent.click(accept);
  const host = {
    ...game,
    timeline: game.timeline.map((tick) => ({ ...tick, temperatureC: -40 })),
  };
  const fresh = powerAgreementQuote(host, "champlain-quebec")!;
  expect(fresh.quoteKey).not.toBe(
    powerAgreementQuote(game, "champlain-quebec")!.quoteKey,
  );
  await act(async () => {
    store.dispatch(multiplayerSnapshot(host));
    reject(new Error("This agreement quote has changed. Review it again."));
  });
  expect(dialog).toBeVisible();
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    /quote has changed/,
  );
  expect(accept).toBeEnabled();
  expect(
    within(dialog).getByRole("row", { name: /Agreement price/ }),
  ).toHaveTextContent(rate(fresh.priceToday));
  expect(store.getState().ui.snackbar.message).not.toMatch(
    /Agreement accepted/,
  );
  submit.mockImplementationOnce(async () => {
    store.dispatch(
      multiplayerSnapshot(
        gameReducer(
          store.getState().game,
          acceptPowerAgreement({
            blockId: fresh.id,
            quoteKey: fresh.quoteKey,
            durationYears: fresh.durationYears,
          }),
        ),
      ),
    );
  });
  fireEvent.click(accept);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(submit).toHaveBeenLastCalledWith({
    kind: "action",
    name: "acceptPowerAgreement",
    payload: {
      blockId: fresh.id,
      quoteKey: fresh.quoteKey,
      durationYears: fresh.durationYears,
    },
  });
  expect(store.getState().ui.snackbar.message).toMatch(/Agreement accepted/);
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
    expect(dialog).not.toHaveTextContent("The price follows inflation");
  },
);
