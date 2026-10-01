import { FuelNameType, LocationType } from "../Types";
import snapshot from "./DataCenterPowerCapacity.json";

export interface DataCenterPowerMix {
  geography: string;
  year: number;
  basis: "capacity";
  scope: "state" | "country" | "world";
  sourceUrl: string;
  geothermalSourceUrl?: string;
  reconciledGeothermal?: boolean;
  shares: Partial<Record<FuelNameType, number>>;
  /** Fraction not represented by a game fuel; shares plus this sum to one. */
  unsupportedShare: number;
}

type CapacityYears = Record<string, number[]>;
const countries: Record<string, CapacityYears> = snapshot.countries;
const states: Record<string, { name: string; years: CapacityYears }> =
  snapshot.states;
const FUELS: FuelNameType[] = [
  "Coal",
  "Natural Gas",
  "Oil",
  "Uranium",
  "Hydro",
  "Sun",
  "Wind",
  "Biomass",
  "Geothermal",
];

/** Historical capacity mix, frozen at the latest observed year for future starts.
 * A regional portfolio is not a claim that these plants sit inside the city.
 * Ember's Other Fossil is represented by Oil; residual Other Renewables stays unmapped.
 * Storage is excluded: its MW cannot establish its energy duration.
 */
export function getDataCenterPowerMix(
  location: LocationType,
  startingYear = new Date().getFullYear(),
): DataCenterPowerMix {
  const state =
    location.country === "United States"
      ? states[location.admin || ""]
      : undefined;
  const country =
    location.admin === "Puerto Rico" ? "Puerto Rico" : location.country || "";
  const scope = state ? "state" : countries[country] ? "country" : "world";
  const years = state?.years || countries[country] || countries.World;
  const available = Object.keys(years)
    .map(Number)
    .filter((year) => years[year].some((value) => value > 0))
    .sort((a, b) => a - b);
  const year =
    [...available].reverse().find((value) => value <= startingYear) ||
    available[0];
  const values = years[year];
  // Country sources do not consistently separate geothermal from Other
  // Renewables. Treat possible overlap conservatively, without rewriting the
  // source observations or claiming the remainder is a measured technology.
  const geothermal = !state ? values[8] : 0;
  const unsupportedCapacity = Math.max(0, values[FUELS.length] - geothermal);
  const total =
    values.slice(0, FUELS.length).reduce((sum, value) => sum + value, 0) +
    unsupportedCapacity;
  const shares: Partial<Record<FuelNameType, number>> = {};
  FUELS.forEach((fuel, index) => {
    if (values[index] > 0) shares[fuel] = values[index] / total;
  });
  return {
    geography: state?.name || (scope === "country" ? country : "World"),
    year,
    basis: "capacity",
    scope,
    sourceUrl: state
      ? `https://www.eia.gov/electricity/state/xls/SEP%20Tables%20for%20${location.admin}.xlsx`
      : "https://ember-energy.org/data/yearly-electricity-data/",
    ...(!state && values[8] > 0
      ? {
          geothermalSourceUrl:
            year < 2015
              ? "https://www.irena.org/-/media/Files/IRENA/Agency/Publication/2020/Mar/IRENA_RE_Capacity_Statistics_2020.pdf"
              : "https://www.irena.org/-/media/Files/IRENA/Agency/Publication/2025/Mar/IRENA_DAT_RE_Capacity_Statistics_2025.pdf",
          reconciledGeothermal: values[FUELS.length] > 0,
        }
      : {}),
    shares,
    unsupportedShare: unsupportedCapacity / total,
  };
}
