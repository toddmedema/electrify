import { FacilityOperatingType, isStorage } from "../../Types";
import { facilityPermanentlyShutdown } from "../../helpers/Financials";
import {
  isUpgradingAt,
  retrofitOutputMultiplier,
  upgradeProgress,
} from "../../helpers/Hazards";
import type { TerritoryTileView } from "../../helpers/TerritoryMapState";
import { constructionFraction } from "./ConstructionProgress";

export type FacilityMapStatusKind =
  "construction" | "paused" | "producing" | "idle" | "charging" | "unknown";

export interface FacilityMapStatus {
  kind: FacilityMapStatusKind;
  label: string;
  progress?: number;
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
  const facility = view.operatingFacility;
  if (facility) {
    const status = facilityOperatingStatus(facility, minute);
    if (facility.yearsToBuildLeft > 0)
      return { ...status, progress: constructionFraction(facility) };
    if (status.kind === "construction" && facility.upgradeInProgress)
      return {
        ...status,
        progress: upgradeProgress(facility.upgradeInProgress, minute),
      };
    const expansion = facility.expansionInProgress;
    return includeConstruction && expansion
      ? {
          kind: "construction",
          label: status.label,
          progress: constructionFraction(expansion),
        }
      : status;
  }
  if (view.facility.yearsToBuildLeft > 0)
    return {
      kind: "construction",
      label: "Under construction",
      progress: constructionFraction(view.facility),
    };
  return { kind: "unknown", label: "Operating status unavailable" };
}
