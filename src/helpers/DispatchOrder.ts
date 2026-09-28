import {
  FacilityOperatingType,
  FacilityShoppingType,
  isStorage,
} from "../Types";

/**
 * A plant built to cover peaks: cheap to build and quick to start, but dear to run. U.S.
 * simple-cycle gas turbines ran about 12% of the year over the last decade (EIA Electric Power
 * Monthly Table 6.07.A), against 57% for combined cycles. Oil is left out on purpose: the game's
 * oil plant also stands in for the oil-fired baseload of island grids.
 */
export function isPeakingPlant(
  facility: Pick<FacilityShoppingType, "gasCycle" | "peakWh">,
): boolean {
  return !isStorage(facility) && facility.gasCycle === "simple";
}

/**
 * Where a newly purchased facility enters the dispatch list. The list is the dispatch order, and
 * a new plant goes to the top so the player sees it run, except a peaker, which would then burn its
 * expensive fuel as baseload: it joins just above the existing peakers (and storage), below every
 * other generator. Storage keeps its place at the bottom. The player can reorder either freely.
 */
export function defaultDispatchIndex(
  facilities: readonly Pick<FacilityOperatingType, "gasCycle" | "peakWh">[],
  facility: Pick<FacilityShoppingType, "gasCycle" | "peakWh">,
): number {
  if (isStorage(facility)) return facilities.length;
  if (!isPeakingPlant(facility)) return 0;
  const firstPeakOrStorage = facilities.findIndex(
    (existing) => isStorage(existing) || isPeakingPlant(existing),
  );
  return firstPeakOrStorage === -1 ? facilities.length : firstPeakOrStorage;
}
