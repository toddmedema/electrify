import { getUtilityArea } from "../../data/UtilityExpansion";
import { FacilityOperatingType } from "../../Types";

type LabeledFacility = Pick<
  FacilityOperatingType,
  "name" | "startingAssetId" | "operatingAreaId"
>;

/** Stable mission identities stay visible while name continues to identify technology and artwork. */
export function facilityDisplayName(facility: LabeledFacility): string {
  if (facility.startingAssetId === "scenario-116-champlain-oil-a")
    return "Oil A";
  if (facility.startingAssetId === "scenario-116-champlain-oil-b")
    return "Oil B";
  return facility.name;
}

/** Disambiguate equal technologies in different operating areas for inspection and sale. */
export function facilityActionName(facility: LabeledFacility): string {
  const area =
    facility.operatingAreaId && getUtilityArea(facility.operatingAreaId);
  return area
    ? `${area.name} ${facilityDisplayName(facility)}`
    : facilityDisplayName(facility);
}
