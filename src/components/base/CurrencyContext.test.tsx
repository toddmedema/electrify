import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { configureStore, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import type { LocationType } from "../../Types";
import { currencyByCode, CurrencyType } from "../../helpers/Currency";
import CurrencyProvider, { useCurrency, useMoney } from "./CurrencyContext";

const place = (country: string): LocationType => ({
  id: country,
  name: country,
  lat: 0,
  long: 0,
  country,
});

function Label({ override }: { override?: CurrencyType }) {
  const currency = useCurrency();
  const money = useMoney(override);
  return (
    <output>
      {currency.code}: {money.formatMoneyConcise(100)}
    </output>
  );
}

// This mirrors the compositor's render guard. Context must update labels through it.
const RenderGuard = React.memo(
  ({ children }: { children: React.ReactNode }) => <>{children}</>,
  () => true,
);

test("standalone labels default to USD and explicit previews can override them", () => {
  const { rerender } = render(<Label />);
  expect(screen.getByText("USD: $100")).toBeInTheDocument();
  rerender(<Label override={currencyByCode("EUR")} />);
  expect(screen.getByText("USD: €85.1")).toBeInTheDocument();
});

test("the provider follows the location and starting year through render guards", () => {
  const game = createSlice({
    name: "game",
    initialState: { location: place("France"), startingYear: 2020 },
    reducers: {
      change: (
        _state,
        action: PayloadAction<{ location: LocationType; startingYear: number }>,
      ) => action.payload,
    },
  });
  const store = configureStore({ reducer: { game: game.reducer } });
  render(
    <Provider store={store}>
      <CurrencyProvider>
        <RenderGuard>
          <Label />
        </RenderGuard>
      </CurrencyProvider>
    </Provider>,
  );
  expect(screen.getByText("EUR: €85.1")).toBeInTheDocument();
  act(() => {
    store.dispatch(
      game.actions.change({ location: place("Ukraine"), startingYear: 1986 }),
    );
  });
  expect(screen.getByText("SUR: SUR 100")).toBeInTheDocument();
  act(() => {
    store.dispatch(
      game.actions.change({ location: place("Ukraine"), startingYear: 2020 }),
    );
  });
  expect(screen.getByText("UAH: ₴4.22k")).toBeInTheDocument();
});
