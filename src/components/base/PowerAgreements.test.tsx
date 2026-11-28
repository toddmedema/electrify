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
import type { AgreementForecast } from "../../helpers/AgreementForecast";
import { getDateFromMinute } from "../../helpers/DateTime";
import { formatMoneyFull, formatNumber } from "../../helpers/Format";
import { currentTick } from "../../helpers/GameSelectors";
import {
  agreementYearMinute,
  connectionAgreements,
  inheritedConnection,
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
const rate = (value: number) => `${formatMoneyFull(value)}/MWh`;
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
  const line = inheritedConnection("champlain", 1);
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
    return <PowerAgreements game={state} line={line} />;
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

it.each([1, 2, 3] as PowerAgreementTermsVersion[])(
  "keeps v%s commitment and minimum exposure visible while disclosing secondary terms",
  (version) => {
    const game = fixture();
    game.transmission!.inheritedAgreementTerms = version;
    const source = connectionAgreements(game, "champlain").find(
      (entry) => entry.id === "champlain-nuclear",
    )!;
    mount(game);
    const agreement = screen.getByRole("article", { name: "Regional nuclear" });
    expect(within(agreement).getByText("Max supply")).toBeVisible();
    expect(within(agreement).getByText("95MW")).toBeVisible();
    expect(within(agreement).getByText(rate(source.priceToday))).toBeVisible();
    expect(
      within(agreement).getByRole("row", { name: /^Final month/ }),
    ).toHaveTextContent("Dec 2019");
    expect(
      within(agreement).getByRole("row", { name: /^Min payment/ }),
    ).toHaveTextContent(
      version === 1 ? "No minimum purchase" : /Paid even if unused/,
    );
    const details = within(agreement).getByRole("group", {
      name: "Regional nuclear details",
    });
    expect(details).not.toHaveAttribute("open");
    expect(within(agreement).getByText(/Market now/)).not.toBeVisible();
    fireEvent.click(within(agreement).getByText("Details"));
    expect(details).toHaveAttribute("open");
    expect(within(agreement).getByText(/Market now/)).toBeVisible();
    expect(
      within(details).getByRole("table", { name: "Trade details" }),
    ).toBeVisible();
  },
);

it("shows recorded usage as a labeled share of available energy in Details", () => {
  const game = fixture();
  game.transmission!.agreementAccounts = [
    {
      agreementId: "champlain-nuclear",
      termsVersion: 3,
      accountingStartMinute: 0,
      accountedThroughMinute: 1440,
      months: [
        {
          month: 0,
          availableMWh: 100,
          usefulMWh: 65,
          availableValue: 0,
          usefulValue: 0,
          payment: 0,
        },
      ],
    },
  ];
  mount(game);
  const agreement = screen.getByRole("article", { name: "Regional nuclear" });
  fireEvent.click(within(agreement).getByText("Details"));
  expect(
    within(agreement).getByLabelText("Share of available energy used"),
  ).toHaveAttribute("value", "65");
  expect(within(agreement).getByText(/65.0% used/)).toBeVisible();
});

it("uses a short offer action with a unique accessible contract name", () => {
  mount();
  expect(screen.getAllByRole("article")[0]).toHaveAccessibleName(
    "Regional nuclear",
  );
  const offer = screen.getByRole("button", {
    name: "Review Valley Electric supply trade",
  });
  expect(offer).toHaveTextContent(/^Review$/);
  expect(
    screen.queryByRole("heading", {
      name: "Supply trades",
    }),
  ).not.toBeInTheDocument();
  fireEvent.click(offer);
  const dialog = screen.getByRole("dialog", {
    name: "Review Valley Electric supply trade",
  });
  expect(
    within(dialog).getByRole("table", { name: "Trade terms" }),
  ).toBeVisible();
});

it("retains expired recorded history without a live commitment or forecast", () => {
  const game = fixture();
  game.date = getDateFromMinute(agreementYearMinute(2020), game.startingYear);
  game.transmission!.agreementAccounts = [
    {
      agreementId: "champlain-nuclear",
      termsVersion: 3,
      accountingStartMinute: agreementYearMinute(2020) - 1440,
      accountedThroughMinute: agreementYearMinute(2020),
      months: [
        {
          month: 179,
          availableMWh: 0,
          usefulMWh: 0,
          availableValue: 0,
          usefulValue: 0,
          payment: 0,
        },
      ],
    },
  ];
  mount(game);
  const agreement = screen.getByRole("article", { name: "Regional nuclear" });
  expect(
    within(agreement).queryByText(/Minimum payment/),
  ).not.toBeInTheDocument();
  expect(within(agreement).queryByText("Max supply")).not.toBeInTheDocument();
  fireEvent.click(
    within(agreement).getByRole("button", {
      name: "Regional nuclear recorded history",
    }),
  );
  expect(
    within(screen.getByRole("dialog")).getByRole("table", {
      name: "Recorded trade history",
    }),
  ).toBeVisible();
  expect(mockForecast.mock.lastCall?.[1]).toBeUndefined();
});

it("quotes the Ridge supplier's own reference price", () => {
  const { game, line } = mount();
  const now = currentTick(game)!;
  const otherMarket = adjacentMarketPricePerMWh(
    line.corridorId,
    intertieContextForGame(game),
    now.minute,
    now,
  );
  const quote = powerAgreementQuote(game, "ridge-purchase")!;
  const reference = quote.receipt.signingMarketPricePerMWh!;
  expect(reference).not.toBe(otherMarket);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Review Ridge Electric supply trade",
    }),
  );
  expect(
    within(screen.getByRole("dialog")).getByRole("row", {
      name: /Reference price/,
    }),
  ).toHaveTextContent(rate(reference));
});

it("shows the direct discount alongside monthly energy and deliverable power", () => {
  const { game, line, dialog, quote } = review();
  expect(agreementSummary(game, line.corridorId)).toContain("209MW committed");
  const table = within(dialog).getByRole("table");
  expect(
    within(table)
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent),
  ).toEqual([
    "Trade price",
    "Reference price",
    "Discount",
    "Min payment",
    "Maximum supply",
    "Duration",
    "Final month",
    "Forecasted cash impact",
    "Forecasted grid impact",
  ]);
  const max = within(table).getByRole("row", { name: /Maximum supply/ });
  expect(max).toHaveTextContent("57 MW");
  expect(max).toHaveTextContent(
    `${formatNumber(quote.maximumMWhPerMonth)} MWh/month`,
  );
  expect(max).not.toHaveTextContent("60 MW");
  expect(
    within(table).getByRole("row", { name: /Min payment/ }),
  ).toHaveTextContent(
    `${formatNumber(quote.minimumMWhPerMonth)} MWh/monthPaid even if unused`,
  );
  expect(
    within(table).getByRole("row", { name: /Duration/ }),
  ).toHaveTextContent("10 years");
  expect(
    within(dialog).getByRole("row", { name: /^Final month/ }),
  ).toHaveTextContent("Dec 2029");
  expect(dialog).not.toHaveTextContent("Delivery and emissions follow");
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

it("keeps the grid impact row mounted while the duration changes", () => {
  const initial = { blocked: undefined, error: false, retry: jest.fn() };
  const result = {
    cashDifference: 1000,
    withAgreement: { demandMWh: 100, servedMWh: 100 },
    withoutAgreement: { demandMWh: 100, servedMWh: 60 },
  } as AgreementForecast;
  mockForecast.mockImplementation((_game, offer, committed) => ({
    ...initial,
    result: committed && offer?.durationYears === 10 ? result : undefined,
    updating: offer?.durationYears === 1,
  }));

  const { dialog } = review();
  const gridImpact = () =>
    within(dialog).getByRole("row", { name: /^Forecasted grid impact/ });
  const row = gridImpact();
  expect(row).toHaveTextContent("60 → 100%");
  expect(
    within(dialog).getByRole("row", { name: /Forecasted cash impact/ }),
  ).not.toHaveTextContent("Demand served");

  fireEvent.change(within(dialog).getByRole("slider", { name: "Duration" }), {
    target: { value: "1" },
  });
  expect(gridImpact()).toBe(row);
  expect(row).not.toHaveTextContent("60 → 100%");
});

it.each([20, -40])(
  "shows precise agreement and real market prices at %s°C",
  (temperature) => {
    const { dialog, marketPrice, quote } = review(temperature);
    expect(quote.priceToday).toBeLessThan(marketPrice);
    expect(
      within(dialog).getByRole("row", { name: /Trade price/ }),
    ).toHaveTextContent(`${rate(quote.priceToday)}Follows inflation`);
    const comparison = within(dialog).getByRole("row", {
      name: /Reference price/,
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
    within(dialog).getByRole("row", { name: /Trade price/ }),
  ).toHaveTextContent(rate(short.priceToday));
  expect(short.priceToday).toBeGreaterThan(quote.priceToday);
  expect(
    within(dialog).getByRole("row", { name: /^Discount/ }),
  ).toHaveTextContent("1%");
  expect(
    within(dialog).getByRole("row", { name: /Duration/ }),
  ).toHaveTextContent("1 year");
  expect(
    within(dialog).getByRole("row", { name: /^Final month/ }),
  ).toHaveTextContent("Dec 2020");
  expect(mockForecast).toHaveBeenLastCalledWith(
    store.getState().game,
    short.receipt,
    true,
  );
  fireEvent.change(slider, { target: { value: "5" } });
  const selected = powerAgreementQuote(game, quote.id, 3, 5)!;
  expect(
    within(dialog).getByRole("row", { name: /^Discount/ }),
  ).toHaveTextContent("9.44%");
  expect(
    within(dialog).getByRole("row", { name: /Duration/ }),
  ).toHaveTextContent("5 years");
  expect(
    within(dialog).getByRole("row", { name: /^Final month/ }),
  ).toHaveTextContent("Dec 2024");
  fireEvent.click(within(dialog).getByRole("button", { name: "Accept trade" }));
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
    name: "Accept trade",
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
  expect(store.getState().ui.snackbar.message).not.toMatch(/Trade accepted/);
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
  expect(store.getState().ui.snackbar.message).not.toMatch(/Trade accepted/);
  await act(async () => acknowledge());
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(store.getState().ui.snackbar.message).toMatch(/Trade accepted/);
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
      /Trade terms changed/,
    ),
  );
  expect(dialog).toBeVisible();
  expect(accept).toBeEnabled();
  expect(store.getState().ui.snackbar.message).not.toMatch(/Trade accepted/);
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
    within(dialog).getByRole("row", { name: /Trade price/ }),
  ).toHaveTextContent(rate(fresh.priceToday));
  expect(store.getState().ui.snackbar.message).not.toMatch(/Trade accepted/);
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
  expect(store.getState().ui.snackbar.message).toMatch(/Trade accepted/);
});

it("displays exact converted agreement prices without changing the quoted terms", () => {
  const game = fixture();
  game.location = { ...game.location, country: "France" };
  const quote = powerAgreementQuote(game, "champlain-quebec")!;
  const before = JSON.stringify(quote.receipt);
  mount(game);
  fireEvent.click(
    screen.getByRole("button", { name: "Review Québec hydro replacement" }),
  );
  const dialog = screen.getByRole("dialog", {
    name: "Review Québec hydro replacement",
  });
  const localPrice = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(quote.priceToday * 0.851);
  expect(within(dialog).getByText(`€${localPrice}/MWh`)).toBeInTheDocument();
  expect(
    JSON.stringify(powerAgreementQuote(game, "champlain-quebec")!.receipt),
  ).toBe(before);
});
