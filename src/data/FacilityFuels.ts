import type { FuelNameType, ModFacilityNameType } from "../Types";

/** Fuel identities are independent of a technology's date/location availability and quotes. */
export const FACILITY_FUELS = {
  Coal: "Coal",
  Nuclear: "Uranium",
  "Natural Gas Peaker": "Natural Gas",
  "Natural Gas CC": "Natural Gas",
  Oil: "Oil",
  Biomass: "Biomass",
  Wind: "Wind",
  "Offshore Wind": "Offshore Wind",
  "Airborne Wind": "Airborne Wind",
  Solar: "Sun",
  Hydro: "Hydro",
  Geothermal: "Geothermal",
  "Enhanced Geothermal": "Geothermal",
  Battery: undefined,
  "Pumped Hydro": undefined,
} as const satisfies Record<ModFacilityNameType, FuelNameType | undefined>;
