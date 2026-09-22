import type { GameType, LocationType, ScenarioFacilityType } from "../Types";
import { LOCATIONS } from "../Constants";
import catalogue from "./HydroSiteCatalogue.json";

export interface HydroSite {
  id: string;
  name: string;
  maxPeakW: number;
  lat: number;
  lon: number;
}
export interface HydroInventory {
  status: "researched" | "unresearched";
  siteIds: string[];
  researchDisposition: string;
  authoredScenarioId?: number;
  locationId?: string;
  locationLat?: number;
  locationLong?: number;
}
export const HYDRO_SITES: Readonly<Record<string, HydroSite>> =
  Object.fromEntries(catalogue.sites.map((site) => [site.id, site]));
export const HYDRO_INVENTORIES = catalogue.inventories as Record<
  string,
  HydroInventory
>;
type HydroState = Pick<
  GameType,
  | "location"
  | "facilities"
  | "commissionedHydroSiteIds"
  | "scenarioId"
  | "customScenario"
>;
export function isConventionalHydro(facility: {
  fuel?: unknown;
  peakWh?: unknown;
}): boolean {
  return facility.fuel === "Hydro" && facility.peakWh === undefined;
}
export function validHydroCapacity(peakW: number): boolean {
  return Number.isSafeInteger(peakW) && peakW > 0;
}
function canonicalLocation(location: LocationType | undefined): boolean {
  if (!location) return false;
  const builtIn = LOCATIONS[location.id];
  const inventory = HYDRO_INVENTORIES[location.id];
  return (
    (builtIn?.lat ?? inventory?.locationLat) === location.lat &&
    (builtIn?.long ?? inventory?.locationLong) === location.long
  );
}
export function getHydroInventoryKey(
  state: Pick<HydroState, "location" | "scenarioId" | "customScenario">,
): string | undefined {
  if (!canonicalLocation(state.location)) return undefined;
  if (!state.customScenario) {
    const exception = Object.entries(HYDRO_INVENTORIES).find(
      ([, inventory]) =>
        inventory.authoredScenarioId === state.scenarioId &&
        inventory.locationId === state.location.id,
    );
    if (exception) return exception[0];
  }
  return state.location.id;
}
/** Physical membership is independent of construction permission for inherited/historical assets. */
export function resolveHydroInventory(
  location: LocationType | undefined,
  inventoryKey?: string,
): HydroInventory | undefined {
  if (!canonicalLocation(location)) return undefined;
  const inventory = HYDRO_INVENTORIES[inventoryKey || location!.id];
  if (inventory?.locationId && inventory.locationId !== location!.id)
    return undefined;
  return inventory;
}
function compareHydroSites(a: HydroSite, b: HydroSite): number {
  return a.maxPeakW - b.maxPeakW || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function bestFitHydroSite(
  sites: readonly HydroSite[],
  peakW: number,
): HydroSite | undefined {
  return validHydroCapacity(peakW)
    ? sites.filter((site) => site.maxPeakW >= peakW).sort(compareHydroSites)[0]
    : undefined;
}
export function getHydroAvailability(state: HydroState, peakW: number) {
  const inventory = resolveHydroInventory(
    state.location,
    getHydroInventoryKey(state),
  );
  const used = new Set(state.commissionedHydroSiteIds || []);
  state.facilities.forEach((f) => {
    if (isConventionalHydro(f) && f.hydroSiteId) used.add(f.hydroSiteId);
  });
  const sites =
    inventory?.siteIds.map((id) => HYDRO_SITES[id]).filter(Boolean) || [];
  const remaining = sites
    .filter((site) => !used.has(site.id))
    .sort(compareHydroSites);
  const eligible = validHydroCapacity(peakW)
    ? remaining.filter((site) => site.maxPeakW >= peakW)
    : [];
  const status:
    | "available"
    | "prohibited"
    | "unavailable"
    | "empty"
    | "exhausted"
    | "too-large" =
    state.location.resources?.hydro === false
      ? "prohibited"
      : !inventory || inventory.status === "unresearched"
        ? "unavailable"
        : !sites.length
          ? "empty"
          : !remaining.length
            ? "exhausted"
            : !eligible.length
              ? "too-large"
              : "available";
  return {
    status,
    remaining,
    eligible,
    selected: eligible[0] as HydroSite | undefined,
    largest: remaining[remaining.length - 1] as HydroSite | undefined,
  };
}
/** Reserve explicit IDs first, then largest plants; return assignments in unchanged authored order. */
export function resolveStartingHydroSites(
  location: LocationType,
  fleet: readonly ScenarioFacilityType[],
  inventoryKey?: string,
): (string | undefined)[] {
  const inventory = resolveHydroInventory(location, inventoryKey);
  const available = new Map(
    (inventory?.status === "researched" ? inventory.siteIds : []).map((id) => [
      id,
      HYDRO_SITES[id],
    ]),
  );
  if (
    fleet.some(
      (f) =>
        f.hydroSiteId !== undefined &&
        f.name !== "Hydro" &&
        !isConventionalHydro(f),
    )
  )
    throw new Error(
      "Only conventional Hydro starting plants can claim a Hydro site.",
    );
  const assignments: (string | undefined)[] = fleet.map(() => undefined);
  const hydro = fleet
    .map((facility, index) => ({ facility, index }))
    .filter(
      ({ facility }) => facility.name === "Hydro" || facility.fuel === "Hydro",
    );
  const claim = (
    facility: ScenarioFacilityType,
    index: number,
    id?: string,
  ) => {
    if (
      (facility.name !== undefined && facility.name !== "Hydro") ||
      (facility.fuel !== undefined && facility.fuel !== "Hydro") ||
      facility.peakWh !== undefined
    )
      throw new Error(
        "Starting Hydro plants must use the conventional Hydro technology without storage capacity.",
      );
    if (
      facility.hydroSiteId !== undefined &&
      (typeof id !== "string" || !id.length)
    )
      throw new Error("Starting Hydro site ID must be a non-empty string.");
    const site = id
      ? available.get(id)
      : bestFitHydroSite([...available.values()], facility.peakW || 0);
    if (
      !site ||
      !validHydroCapacity(facility.peakW || 0) ||
      site.maxPeakW < facility.peakW!
    )
      throw new Error(
        `Starting Hydro plant ${index + 1} (${facility.peakW || 0} W) needs a unique researched site large enough for its capacity. Choose a smaller plant or another location.`,
      );
    assignments[index] = site.id;
    available.delete(site.id);
  };
  hydro
    .filter(({ facility }) => facility.hydroSiteId !== undefined)
    .forEach(({ facility, index }) =>
      claim(facility, index, facility.hydroSiteId),
    );
  hydro
    .filter(({ facility }) => facility.hydroSiteId === undefined)
    .sort(
      (a, b) =>
        (b.facility.peakW || 0) - (a.facility.peakW || 0) || a.index - b.index,
    )
    .forEach(({ facility, index }) => claim(facility, index));
  return assignments;
}
export function validHydroClaims(state: HydroState): boolean {
  if (
    !Array.isArray(state.commissionedHydroSiteIds) ||
    state.customScenario?.hydroInventoryKey !== undefined ||
    Object.prototype.hasOwnProperty.call(state, "hydroInventoryKey")
  )
    return false;
  const inventory = resolveHydroInventory(
    state.location,
    getHydroInventoryKey(state),
  );
  const ids = new Set(
    inventory?.status === "researched" ? inventory.siteIds : [],
  );
  const history = new Set(state.commissionedHydroSiteIds);
  if (
    history.size !== state.commissionedHydroSiteIds.length ||
    [...history].some((id) => typeof id !== "string" || !ids.has(id))
  )
    return false;
  const current = new Set<string>();
  return state.facilities.every((f) => {
    if (!f || typeof f !== "object") return false;
    if (!isConventionalHydro(f))
      return (
        f.hydroSiteId === undefined && f.name !== "Hydro" && f.fuel !== "Hydro"
      );
    const id = f.hydroSiteId;
    if (
      typeof id !== "string" ||
      !ids.has(id) ||
      current.has(id) ||
      !validHydroCapacity(f.peakW) ||
      f.peakW > HYDRO_SITES[id].maxPeakW ||
      typeof f.yearsToBuildLeft !== "number" ||
      !Number.isFinite(f.yearsToBuildLeft) ||
      f.yearsToBuildLeft < 0
    )
      return false;
    current.add(id);
    return f.yearsToBuildLeft === 0 ? history.has(id) : !history.has(id);
  });
}
