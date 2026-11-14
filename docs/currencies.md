# Local currency display

Game cash, costs, retail rates, forecasts and scores are stored and calculated in
USD. Currency is a presentation choice resolved from the location's country.
Formatting multiplies a USD value by `unitsPerDollar` exactly once; it never writes
converted amounts into the game state. There is no runtime exchange-rate request.

Every country in the shipped weather catalogue has an explicit mapping in
`src/data/Currencies.ts`. Country names match catalogue metadata, rather than
inference from a city name, coordinate or the player's browser locale. Unknown or
metadata-free custom locations use USD. Currency symbols are display prefixes;
ambiguous symbols usually include a country marker or ISO code and, where needed,
a trailing space.

The denomination is the current local currency as of November 2026, regardless of
the scenario's date. A run keeps the currency selected by its location and starting
year; ticking into a later year does not change it. These are fixed display rates,
not a historical foreign-exchange simulation. The Chernobyl exception uses SUR
(Soviet ruble) for Ukraine runs beginning before 1992. Its rate of 1 SUR per USD is
an illustrative game display anchor, not a claim about historical purchasing power
or a market exchange rate. Other dates and locations use the current denomination.

## Sources and frozen rates

The base rates are the U.S. Treasury's **December 31, 2025**, unamended reporting
rates, expressed as local major units per USD. The Treasury describes the dataset
and its reporting purpose on its [reporting-rates page](https://fiscal.treasury.gov/resources/reporting-rates-exchange).
The [original published report](https://fiscaldata.treasury.gov/static-data/published-reports/exchange-rates/Rates_of_Exchange_12312025.pdf)
is the primary rate source. Treasury endpoints returned errors during this change,
so the same five-page Treasury report was retrieved from this
[public report mirror](https://www.ustaxsolutionsgmbh.com/_files/ugd/ca3ce6_88ba6fbcf28b4b99b911cb662b213301.pdf).
Rates deliberately stay frozen when that reporting dataset receives later updates.
The current currency country/code reference is the
[SIX ISO 4217 register](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html).

The following cases supplement the report or reconcile its denomination with the
current display policy:

- Belarus: BYN 2.9027 per USD, the National Bank of the Republic of Belarus's
  December 31, 2025 daily USD rate. Its
  [historical API query](https://api.nbrb.by/exrates/rates/431?ondate=2025-12-31)
  identifies the series and date. The value is also reproduced in this
  [dated NBRB rate archive](https://kurs.vip/currencies/nbrb/usd/2025-12-31).
- French Polynesia and New Caledonia: XPF, derived from the Treasury EUR rate
  (0.851) and the [IEOM fixed parity](https://www.ieom.fr/?lang=en) of
  1,000 XPF = EUR 8.38. The stored expression is `0.851 * 1000 / 8.38`.
- Panama: PAB at 1 per USD. The Treasury lists Panama in dollars; the
  [Superintendency of Banks](https://www.superbancos.gob.pa/documents/laws_regulations/circulars/2011/circular_46-2011-en.pdf)
  documents balboa coins' parity with USD. Ecuador and El Salvador use USD.
- Bulgaria: EUR at the same 0.851 display rate as the rest of the euro area,
  following its [January 1, 2026 adoption](https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.pr260101~c830245e42.en.html).
  The report's older BGN denomination is not used.
- Syria: current SYP at 110 per USD, the report's 11,000 old pounds divided by
  the [January 1, 2026 redenomination](https://sana.sy/en/syria/2286703/) ratio
  of 100 old pounds to one new pound.
- Venezuela: VES uses the report's current bolívar row (300.618), not its old
  fuerte row. Zimbabwe uses ZWG (Zimbabwe Gold), not a withdrawn Zimbabwe dollar.
- SUR is the illustrative exception described above and has no Treasury rate.

## Formatter and UI ownership

`currencyForLocation(location, startingYear)` and `currencyByCode(code)` return
allowlisted currency objects. Unknown saved codes resolve to USD. Existing
formatters keep their USD defaults and accept an optional currency as the second
argument. `currencyFormatters(currency)` binds those functions for callback use.
`formatMoneyFull` supplies exact major-unit text without compact significant-digit
rounding; callers choose decimal places for exact prices and converted increments.

USD retail labels retain cents. Other currencies show major units per kWh with
three significant digits, including enough fractional precision for small prices.
Callers add the `/kWh` unit where the surrounding label requires it.

`CurrencyProvider` sits above the compositor and follows `game.location` and
`game.startingYear`. `useMoney()` reads it; `useMoney(override)` binds an explicit
preview or result currency. Previews and saved results must resolve their own
location/year or stored display code so another active game cannot supply their
currency. Old saves infer local currency from retained location metadata. A legacy
custom result that lacks both metadata and a stored currency code cannot recover
its original denomination and uses the documented USD fallback. Previously saved
free-text event messages remain authored strings; newly generated messages use
the run's currency.

Resolver tests check every catalogue country and official scenario. Formatter
tests pin USD compatibility, local major-unit rates, exact prices, signs and tiny
rates. Provider tests verify location/year switching through a render guard and
explicit preview overrides.
