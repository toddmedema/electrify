import { FacilityOperatingType } from "../../Types";

type LabeledFacility = Pick<FacilityOperatingType, "name" | "startingAssetId">;

/** Stable mission identities stay visible while name continues to identify technology and artwork. */
export function facilityDisplayName(facility: LabeledFacility): string {
  if (facility.startingAssetId === "scenario-116-champlain-oil-a")
    return "Oil A";
  if (facility.startingAssetId === "scenario-116-champlain-oil-b")
    return "Oil B";
  if (facility.startingAssetId === "scenario-116-valley-oil")
    return "Valley Oil";
  if (facility.startingAssetId === "scenario-116-ridge-oil") return "Ridge Oil";
  return facility.name;
}
