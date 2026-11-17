import { getBuildFacilityQuote } from "../data/Facilities";
import { getInflationIndex } from "../data/Economy";
import { getHydroSite } from "../data/HydroSites";
import {
  isStorage,
  type ExpandFacilityAction,
  type FacilityExpansionInProgressType,
  type FacilityOperatingType,
  type GameType,
} from "../Types";
import { facilityPermanentlyShutdown } from "./Financials";
import {
  getTerritoryTile,
  hasTerritoryNetwork,
  territoryTilePowerLimit,
  tileFitsFacility,
} from "./TerritoryTiles";

export type FacilityExpansionQuote =
  | ({
      status: "ready";
      facilityId: number;
      currentSize: number;
      deltaSize: number;
      maxSize: number;
      constructionKgco2eTotal: number;
    } & FacilityExpansionInProgressType)
  | { status: "unavailable"; reason: string; maxSize?: number };

/** Request identities only. Reject extra fields so a client cannot smuggle an alternate quote. */
export function validExpandFacilityAction(
  raw: unknown,
): raw is ExpandFacilityAction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const action = raw as Record<string, unknown>;
  return (
    Object.keys(action).every((key) =>
      ["facilityId", "targetSize", "quoteKey"].includes(key),
    ) &&
    Number.isSafeInteger(action.facilityId) &&
    (action.facilityId as number) >= 0 &&
    typeof action.targetSize === "number" &&
    Number.isFinite(action.targetSize) &&
    action.targetSize > 0 &&
    action.targetSize <= 1e12 &&
    typeof action.quoteKey === "string" &&
    action.quoteKey.length > 0 &&
    action.quoteKey.length <= 2000
  );
}

/** Canonical current-era target less current-era equivalent; no historic purchase-price credit. */
export function facilityExpansionQuote(
  game: GameType,
  facilityId: number,
  targetSize: number,
): FacilityExpansionQuote {
  const unavailable = (
    reason: string,
    maxSize?: number,
  ): FacilityExpansionQuote => ({ status: "unavailable", reason, maxSize });
  const facility = game.facilities.find(({ id }) => id === facilityId);
  if (!facility) return unavailable("Plant not found.");
  if (facility.yearsToBuildLeft > 0)
    return unavailable("Finish construction first.");
  if (facility.expansionInProgress)
    return unavailable("Capacity expansion is already under construction.");
  if (facility.upgradeInProgress)
    return unavailable("Finish the existing retrofit first.");
  if (facilityPermanentlyShutdown(facility, game.date.minute))
    return unavailable("This plant is permanently shut down.");
  const currentSize = facility.peakWh ?? facility.peakW;
  if (
    !Number.isFinite(targetSize) ||
    targetSize <= currentSize ||
    targetSize > 1e12
  )
    return unavailable("Choose a larger capacity.");
  // A private pricing context releases only this installation's own reservation. The real fleet
  // and commissioned claims are never changed, including when quote validation fails.
  const context = {
    ...game,
    facilities: game.facilities.filter(({ id }) => id !== facility.id),
    commissionedHydroSiteIds: game.commissionedHydroSiteIds.filter(
      (id) => id !== facility.hydroSiteId,
    ),
  };
  if (
    facility.fuel === "Hydro" &&
    !isStorage(facility) &&
    (!facility.hydroSiteId || !getHydroSite(facility.hydroSiteId))
  )
    return unavailable("This plant has no expandable named hydro site.");
  const request = (size: number) =>
    isStorage(facility)
      ? { name: facility.name, peakWh: size }
      : {
          name: facility.name,
          gasCycle: facility.gasCycle,
          resilience: facility.resilience,
          peakW: size,
        };
  const quoteAt = (size: number) =>
    getBuildFacilityQuote(
      context,
      request(size),
      facility.territoryId,
      facility.tileId,
      facility.fuel === "Hydro" && !isStorage(facility)
        ? facility.hydroSiteId
        : undefined,
    );
  const small = quoteAt(Math.min(currentSize, 1e6));
  if (!small)
    return unavailable("This technology is unavailable for expansion.");
  const tile =
    hasTerritoryNetwork(game) && facility.tileId
      ? getTerritoryTile(facility.tileId, game)
      : undefined;
  if (hasTerritoryNetwork(game) && !tile)
    return unavailable("This plant has no expandable building tile.");
  const wattsPerSize = isStorage(small) ? small.peakW / small.peakWh : 1;
  const maxSize = Math.min(
    isStorage(small) ? small.maxPeakWh : small.maxPeakW,
    tile
      ? currentSize +
          (territoryTilePowerLimit(tile) - facility.peakW) / wattsPerSize
      : Infinity,
  );
  if (targetSize > maxSize)
    return unavailable(
      "This capacity exceeds the technology or site limit.",
      maxSize,
    );
  const current = quoteAt(currentSize);
  const target = quoteAt(targetSize);
  if (!current || !target)
    return unavailable("This capacity is unavailable for expansion.", maxSize);
  const targetPeakW = facility.peakW + target.peakW - current.peakW;
  if (tile && !tileFitsFacility(tile, { ...target, peakW: targetPeakW }))
    return unavailable(
      "This capacity exceeds the building tile limit.",
      maxSize,
    );
  const cost = target.buildCost - current.buildCost;
  const annualOperatingCostDelta =
    target.annualOperatingCost - current.annualOperatingCost;
  const costPerStartDelta =
    (target.costPerStart ?? 0) - (current.costPerStart ?? 0);
  const yearsToBuild = target.yearsToBuild;
  const constructionKgco2eTotal = Math.max(
    0,
    (target.constructionKgco2ePerW ?? 0) * (target.peakW - current.peakW) +
      (target.constructionKgco2ePerWh ?? 0) *
        ((target.peakWh ?? 0) - (current.peakWh ?? 0)),
  );
  if (
    ![cost, yearsToBuild, targetPeakW].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    ![
      annualOperatingCostDelta,
      costPerStartDelta,
      constructionKgco2eTotal,
    ].every((value) => Number.isFinite(value) && value >= 0)
  )
    return unavailable("This expansion has no valid quote.", maxSize);
  const moneyScale =
    (facility.costIndexAtBuild ?? 1) /
    getInflationIndex(game.date, game.startingYear, game.seed);
  const quoteKey = JSON.stringify([
    facility.id,
    currentSize,
    facility.peakW,
    targetSize,
    targetPeakW,
    cost,
    yearsToBuild,
    annualOperatingCostDelta,
    costPerStartDelta,
    constructionKgco2eTotal,
    moneyScale,
    facility.hydroSiteId,
    facility.resilience,
    game.date.year,
    game.date.month,
  ]);
  return {
    status: "ready",
    facilityId,
    currentSize,
    targetSize,
    deltaSize: targetSize - currentSize,
    maxSize,
    targetPeakW,
    ...(isStorage(facility) ? { targetPeakWh: targetSize } : {}),
    cost,
    yearsToBuild,
    yearsToBuildLeft: yearsToBuild,
    startsMinute: game.date.minute,
    annualOperatingCostDelta: annualOperatingCostDelta * moneyScale,
    costPerStartDelta: costPerStartDelta * moneyScale,
    constructionKgco2eTotal,
    constructionKgco2eEmitted: 0,
    quoteKey,
  };
}

/** Apply only extensive changes. Added investment shares the existing asset's depreciation age. */
export function completeFacilityExpansion(
  facility: FacilityOperatingType,
): void {
  const expansion = facility.expansionInProgress;
  if (!expansion || expansion.yearsToBuildLeft > 0) return;
  const scale = expansion.targetPeakW / facility.peakW;
  if (!isStorage(facility)) {
    if (facility.reservoirCapacityWh !== undefined)
      facility.reservoirCapacityWh *= scale;
    if (facility.hydroWhPerMm !== undefined) facility.hydroWhPerMm *= scale;
    if (facility.hydroMeanMonthlyInflowWh !== undefined)
      facility.hydroMeanMonthlyInflowWh *= scale;
  } else if (expansion.targetPeakWh !== undefined)
    facility.peakWh = expansion.targetPeakWh;
  facility.peakW = expansion.targetPeakW;
  facility.buildCost += expansion.cost;
  facility.annualOperatingCost += expansion.annualOperatingCostDelta;
  if (expansion.costPerStartDelta)
    facility.costPerStart =
      (facility.costPerStart ?? 0) + expansion.costPerStartDelta;
  // Preserve the project's booked construction footprint before removing its progress record.
  facility.constructionKgco2eTotal =
    (facility.constructionKgco2eTotal ?? 0) +
    (expansion.constructionKgco2eTotal ?? 0);
  facility.constructionKgco2eEmitted =
    (facility.constructionKgco2eEmitted ?? 0) +
    (expansion.constructionKgco2eEmitted ?? 0);
  delete facility.expansionInProgress;
}

/** Save validation deliberately uses no loaded weather/fuel tables. */
export function validFacilityExpansion(
  facility: FacilityOperatingType,
  game: GameType,
): boolean {
  const raw = facility.expansionInProgress;
  if (raw === undefined) return true;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const allowed = [
    "targetSize",
    "targetPeakW",
    "targetPeakWh",
    "cost",
    "annualOperatingCostDelta",
    "costPerStartDelta",
    "startsMinute",
    "yearsToBuild",
    "yearsToBuildLeft",
    "quoteKey",
    "constructionKgco2eTotal",
    "constructionKgco2eEmitted",
  ];
  if (Object.keys(raw).some((key) => !allowed.includes(key))) return false;
  if (
    ![raw.targetSize, raw.targetPeakW, raw.cost, raw.yearsToBuild].every(
      (value) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0 &&
        value <= 1e15,
    )
  )
    return false;
  if (
    ![
      raw.annualOperatingCostDelta,
      raw.costPerStartDelta,
      raw.startsMinute,
      raw.yearsToBuildLeft,
      raw.constructionKgco2eTotal,
      raw.constructionKgco2eEmitted,
    ].every(
      (value) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1e15,
    )
  )
    return false;
  if (
    facility.yearsToBuildLeft !== 0 ||
    facility.upgradeInProgress ||
    raw.targetSize > 1e12 ||
    raw.targetPeakW > 1e12 ||
    raw.targetSize <= (facility.peakWh ?? facility.peakW) ||
    raw.targetPeakW <= facility.peakW ||
    raw.yearsToBuild > 100 ||
    raw.yearsToBuildLeft > raw.yearsToBuild ||
    raw.startsMinute > game.date.minute ||
    typeof raw.quoteKey !== "string" ||
    !raw.quoteKey.length ||
    raw.quoteKey.length > 2000 ||
    (raw.constructionKgco2eEmitted ?? 0) > (raw.constructionKgco2eTotal ?? 0)
  )
    return false;
  if (
    isStorage(facility)
      ? raw.targetPeakWh !== raw.targetSize
      : raw.targetPeakWh !== undefined || raw.targetSize !== raw.targetPeakW
  )
    return false;
  // The review identity is also a cross-check of duplicated persisted terms. No prices are
  // recalculated during import: weather/economic datasets may not yet have been loaded.
  let reviewed: unknown;
  try {
    reviewed = JSON.parse(raw.quoteKey);
  } catch {
    return false;
  }
  if (!Array.isArray(reviewed) || reviewed.length !== 15) return false;
  const same = (actual: unknown, expected: number) =>
    typeof actual === "number" &&
    Number.isFinite(actual) &&
    Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-9;
  const moneyScale = reviewed[10];
  if (
    typeof moneyScale !== "number" ||
    !Number.isFinite(moneyScale) ||
    moneyScale <= 0 ||
    reviewed[0] !== facility.id ||
    reviewed[1] !== (facility.peakWh ?? facility.peakW) ||
    reviewed[2] !== facility.peakW ||
    reviewed[3] !== raw.targetSize ||
    reviewed[4] !== raw.targetPeakW ||
    reviewed[5] !== raw.cost ||
    reviewed[6] !== raw.yearsToBuild ||
    !same(reviewed[7], raw.annualOperatingCostDelta / moneyScale) ||
    !same(reviewed[8], raw.costPerStartDelta / moneyScale) ||
    reviewed[9] !== raw.constructionKgco2eTotal ||
    reviewed[11] !== (facility.hydroSiteId ?? null) ||
    JSON.stringify(reviewed[12]) !== JSON.stringify(facility.resilience ?? null)
  )
    return false;
  const maximumEmissions =
    (raw.targetPeakW - facility.peakW) * 20 +
    (isStorage(facility) ? raw.targetSize - facility.peakWh : 0);
  if ((raw.constructionKgco2eTotal ?? 0) > maximumEmissions) return false;
  if (hasTerritoryNetwork(game)) {
    const tile = facility.tileId && getTerritoryTile(facility.tileId, game);
    if (
      !tile ||
      !tileFitsFacility(tile, {
        ...facility,
        peakW: raw.targetPeakW,
        peakWh: raw.targetPeakWh,
      })
    )
      return false;
  }
  if (facility.fuel === "Hydro" && !isStorage(facility)) {
    const site = facility.hydroSiteId && getHydroSite(facility.hydroSiteId);
    if (!site || raw.targetPeakW > site.maxPeakW) return false;
  }
  return true;
}
