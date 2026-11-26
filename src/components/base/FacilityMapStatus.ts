import { FacilityOperatingType, isStorage } from "../../Types";
import { facilityPermanentlyShutdown } from "../../helpers/Financials";
import { isUpgradingAt, retrofitOutputMultiplier } from "../../helpers/Hazards";
import type { TerritoryTileView } from "../../helpers/TerritoryMapState";
import type { FacilityConstructionStage } from "./territory-3d/Types";

export type FacilityMapStatusKind =
  "construction" | "paused" | "producing" | "idle" | "charging" | "unknown";

export interface FacilityMapStatus {
  kind: FacilityMapStatusKind;
  label: string;
}

const constructionStages = [0, 1, 2, 3] as const;
export function facilityConstructionStage(
  facility: TerritoryTileView["facility"],
): FacilityConstructionStage | undefined {
  if (!facility || !(facility.yearsToBuildLeft > 0)) return undefined;
  const total = facility.yearsToBuild;
  if (total === undefined || !Number.isFinite(total) || total <= 0) return 0;
  const completed = Math.max(0, 1 - facility.yearsToBuildLeft / total);
  return constructionStages[
    Math.min(
      constructionStages.length - 1,
      Math.floor(completed * constructionStages.length),
    )
  ];
}

/** Keep the existing buried route until a water site's switchgear is fitted. */
export function needsSubmergedCable({
  tile,
  facility,
}: Pick<TerritoryTileView, "tile" | "facility">): boolean {
  if (tile.city || !["lake", "ocean", "river"].includes(tile.terrain))
    return false;
  const stage = facilityConstructionStage(facility);
  return !facility || (stage !== undefined && stage < 3);
}

/** Share measured operating state between the map and the facility inspector. */
export function facilityOperatingStatus(
  facility: FacilityOperatingType,
  minute: number,
): FacilityMapStatus {
  const paused = facility.paused ? "; operation paused" : "";
  if (facility.yearsToBuildLeft > 0)
    return { kind: "construction", label: `Under construction${paused}` };
  if (facilityPermanentlyShutdown(facility, minute))
    return { kind: "idle", label: "Permanently shut down" };
  const upgrading = isUpgradingAt(facility, minute);
  if (upgrading && retrofitOutputMultiplier(facility, minute) === 0)
    return { kind: "construction", label: `Retrofitting${paused}` };
  const retrofit = `${upgrading ? "; retrofit in progress" : ""}${facility.expansionInProgress ? "; capacity upgrade in progress" : ""}`;
  if (facility.paused)
    return { kind: "paused", label: `Operation paused${retrofit}` };
  if (facility.currentW > 0)
    return {
      kind: "producing",
      label: `${isStorage(facility) ? "Discharging" : "Generating"}${retrofit}`,
    };
  if (isStorage(facility) && facility.currentW < 0)
    return { kind: "charging", label: `Charging${retrofit}` };
  return { kind: "idle", label: `Idle${retrofit}` };
}

/** Peers disclose their construction state, but do not disclose measured operation. */
export function facilityMapStatus(
  view: TerritoryTileView,
  minute: number,
  includeConstruction = true,
): FacilityMapStatus | undefined {
  if (view.tile.city || !view.facility) return undefined;
  if (view.operatingFacility) {
    const status = facilityOperatingStatus(view.operatingFacility, minute);
    return includeConstruction && view.operatingFacility.expansionInProgress
      ? { kind: "construction", label: status.label }
      : status;
  }
  if (view.facility.yearsToBuildLeft > 0)
    return { kind: "construction", label: "Under construction" };
  return { kind: "unknown", label: "Operating status unavailable" };
}
