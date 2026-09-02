import type { LocationType } from "../Types";
import { hasGeothermalResource, hasHydroResource } from "./LocationProfiles";

export type SiteLimitedFacilityName = "Hydro" | "Geothermal" | "Pumped Hydro";

/** The only facility state needed to determine whether a project has claimed a site. */
export interface FacilitySiteClaim {
  name: string;
}

// Conventional hydro and geothermal used to express scarcity only through a linear price
// multiplier. Until those resources get the same site-level GIS treatment as pumped hydro, keep
// the old curve's three/four-site scale as an explicit, understandable gameplay limit instead.
const CONVENTIONAL_HYDRO_SITES = 3;
const CONVENTIONAL_GEOTHERMAL_SITES = 4;

/**
 * Modeled greenfield closed-loop pumped-hydro systems within 250 km of each playable city.
 *
 * U.S. counts come from NREL's optimized, non-overlapping 10-hour resource assessment. European
 * counts use the point records in ANU's unprotected 2 GWh / 6 hour global greenfield layer. The
 * radius treats a game location as a regional grid rather than the city boundary. These are
 * technical-potential candidates, not project-level feasibility findings; see the methodology and
 * source links in docs/facilities-economics.md.
 */
export const PUMPED_HYDRO_SITES_BY_LOCATION: Readonly<Record<string, number>> =
  Object.freeze({
    PIT: 179,
    SF: 51,
    LA: 218,
    CAMountains: 885,
    HNL: 104,
    SJU: 7,
    NewYork: 43,
    Chicago: 0,
    Houston: 0,
    Phoenix: 466,
    Philadelphia: 105,
    SanAntonio: 0,
    SanDiego: 90,
    Dallas: 3,
    Austin: 0,
    Jacksonville: 0,
    Columbus: 0,
    Indianapolis: 0,
    Charlotte: 176,
    Seattle: 384,
    Denver: 156,
    Boston: 30,
    Detroit: 0,
    Nashville: 202,
    Portland: 559,
    LasVegas: 1201,
    Memphis: 1,
    Baltimore: 170,
    Manassas: 198,
    Milwaukee: 0,
    Albuquerque: 673,
    Tucson: 256,
    Fresno: 612,
    Sacramento: 522,
    KansasCity: 0,
    Atlanta: 265,
    Miami: 0,
    Minneapolis: 0,
    London: 2,
    Paris: 0,
    Berlin: 2,
    Reykjavik: 648,
    // Keep newly playable global locations explicit. Detailed ANU point exports for these
    // regions are available only by request, so do not invent buildable sites from the map.
    Madrid: 0,
    Beijing: 0,
    Anchorage: 0,
    Asuncion: 0,
    Barcelona: 0,
    Belem: 0,
    Bogota: 0,
    Brasilia: 0,
    Bridgetown: 0,
    BuenosAires: 0,
    Buffalo: 0,
    Calgary: 0,
    Cancun: 0,
    Caracas: 0,
    Cleveland: 0,
    Cordoba: 0,
    Dublin: 0,
    Edinburgh: 0,
    Fairbanks: 0,
    Fortaleza: 0,
    Georgetown: 0,
    Guadalajara: 0,
    GuatemalaCity: 0,
    Guayaquil: 0,
    Halifax: 0,
    Havana: 0,
    Iqaluit: 0,
    Kingston: 0,
    LaPaz: 0,
    Lima: 0,
    Lisbon: 0,
    Lyon: 0,
    Managua: 0,
    Manaus: 0,
    Manchester: 0,
    Marseille: 0,
    Medellin: 0,
    Mendoza: 0,
    MexicoCity: 0,
    Milan: 0,
    Monterrey: 0,
    Montevideo: 0,
    Montreal: 0,
    Naples: 0,
    Nassau: 0,
    NewOrleans: 0,
    PanamaCity: 0,
    Paramaribo: 0,
    PortAuPrince: 0,
    Porto: 0,
    PortoAlegre: 0,
    Quito: 0,
    Recife: 0,
    RioDeJaneiro: 0,
    Rome: 0,
    SaltLakeCity: 0,
    Salvador: 0,
    SanJoseCR: 0,
    SanSalvador: 0,
    Santiago: 0,
    SantoDomingo: 0,
    SaoPaulo: 0,
    Seville: 0,
    StLouis: 0,
    Tegucigalpa: 0,
    Tijuana: 0,
    Toronto: 0,
    Ushuaia: 0,
    Vancouver: 0,
    Winnipeg: 0,
    Yellowknife: 0,
  });

/** Total sites for a finite-site technology, or undefined for an unconstrained technology. */
export function getViableLocationCount(
  location: LocationType | undefined,
  facilityName: string,
): number | undefined {
  if (facilityName === "Hydro") {
    return hasHydroResource(location) ? CONVENTIONAL_HYDRO_SITES : 0;
  }
  if (facilityName === "Geothermal") {
    return hasGeothermalResource(location) ? CONVENTIONAL_GEOTHERMAL_SITES : 0;
  }
  if (facilityName === "Pumped Hydro") {
    return location ? PUMPED_HYDRO_SITES_BY_LOCATION[location.id] || 0 : 0;
  }
  return undefined;
}

/** Counts projects already owned or under construction because either one has claimed its site. */
export function getViableLocationsRemaining(
  location: LocationType | undefined,
  facilities: readonly FacilitySiteClaim[],
  facilityName: string,
): number | undefined {
  const total = getViableLocationCount(location, facilityName);
  if (total === undefined) {
    return undefined;
  }
  const used = facilities.filter(
    (facility) => facility.name === facilityName,
  ).length;
  return Math.max(0, total - used);
}
