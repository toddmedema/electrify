import * as React from "react";
import { useAppSelector } from "../../Store";
import {
  CurrencyType,
  USD_CURRENCY,
  currencyForLocation,
} from "../../helpers/Currency";
import { currencyFormatters } from "../../helpers/Format";

/** Context updates reach labels beneath Compositor's render guard when locations change. */
export const CurrencyContext = React.createContext<CurrencyType>(USD_CURRENCY);

export function useCurrency(): CurrencyType {
  return React.useContext(CurrencyContext);
}

/** Previews and completed results supply their own currency instead of the active game's. */
export function useMoney(override?: CurrencyType) {
  const activeCurrency = useCurrency();
  const currency = override ?? activeCurrency;
  return React.useMemo(() => currencyFormatters(currency), [currency]);
}

export default function CurrencyProvider(props: {
  children: React.ReactNode;
}): React.JSX.Element {
  const location = useAppSelector((state) => state.game.location);
  const startingYear = useAppSelector((state) => state.game.startingYear);
  const currency = currencyForLocation(location, startingYear);
  return (
    <CurrencyContext.Provider value={currency}>
      {props.children}
    </CurrencyContext.Provider>
  );
}
