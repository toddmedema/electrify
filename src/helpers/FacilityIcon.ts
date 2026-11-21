import type { FacilityOperatingType } from "../Types";

export function facilityIconSrc(facility: FacilityOperatingType): string {
  // A scenario may give its uranium plant a name that differs from the standard Nuclear icon.
  const name =
    facility.fuel === "Uranium" ? "nuclear" : facility.name.toLowerCase();
  return `/images/${name}.svg`;
}
