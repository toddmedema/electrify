import { getFuelEscalation, MONEY_BASE_YEAR } from "./FuelPrices";

// U.S. average retail price of electricity to ultimate customers, all sectors, in that year's
// cents per kWh including taxes. EIA Monthly Energy Review, Table 9.8 (series ESTCUUS, annual):
// https://www.eia.gov/totalenergy/data/browser/?tbl=T09.08
// Ends at the money base year: later eras are quoted along the projected fuel trend instead.
const RETAIL_CENTS_PER_KWH: Record<number, number> = {
  1975: 2.9,
  1976: 3.1,
  1977: 3.4,
  1978: 3.7,
  1979: 4.0,
  1980: 4.7,
  1981: 5.5,
  1982: 6.1,
  1983: 6.3,
  1984: 6.25,
  1985: 6.44,
  1986: 6.44,
  1987: 6.37,
  1988: 6.35,
  1989: 6.45,
  1990: 6.57,
  1991: 6.75,
  1992: 6.82,
  1993: 6.93,
  1994: 6.91,
  1995: 6.89,
  1996: 6.86,
  1997: 6.85,
  1998: 6.74,
  1999: 6.64,
  2000: 6.81,
  2001: 7.29,
  2002: 7.2,
  2003: 7.44,
  2004: 7.61,
  2005: 8.14,
  2006: 8.9,
  2007: 9.13,
  2008: 9.74,
  2009: 9.82,
  2010: 9.83,
  2011: 9.9,
  2012: 9.84,
  2013: 10.07,
  2014: 10.44,
  2015: 10.41,
  2016: 10.27,
  2017: 10.48,
  2018: 10.53,
  2019: 10.54,
  2020: 10.59,
};
const EARLIEST_RETAIL_YEAR = 1975;

/**
 * What a kilowatt hour typically sold for in a year, relative to the money base year.
 *
 * Historical eras follow the recorded national average: a 1980 kilowatt hour sold for well under
 * half of a 2020 one, so quoting 1980 at 2020 prices would make every rate on offer look like a
 * price gouge. Future eras follow the same fuel trend inEraMoney uses, since there is no record.
 */
export function getRetailRateIndex(year: number): number {
  if (year >= MONEY_BASE_YEAR) {
    return getFuelEscalation(year) / getFuelEscalation(MONEY_BASE_YEAR);
  }
  return (
    RETAIL_CENTS_PER_KWH[Math.max(year, EARLIEST_RETAIL_YEAR)] /
    RETAIL_CENTS_PER_KWH[MONEY_BASE_YEAR]
  );
}

/**
 * Re-quote a retail rate between starting years, the rate counterpart of inEraMoney. Cash and
 * carbon fees keep sharing one base era through 2020, because build costs open at their table
 * values in every year; the rate instead tracks what customers actually paid in the era. Keeps
 * the exact amount when the years agree, otherwise rounds to two significant figures.
 */
export function inEraRate(
  base: number,
  startingYear: number,
  sourceYear = MONEY_BASE_YEAR,
): number {
  const factor =
    getRetailRateIndex(startingYear) / getRetailRateIndex(sourceYear);
  if (factor === 1) {
    return base;
  }
  return Number((base * factor).toPrecision(2));
}
