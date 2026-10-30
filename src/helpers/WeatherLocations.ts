import type { LocationType } from "../Types";

/** All independently sampled records needed to operate one location's service areas. */
export function weatherLocationIds(location: string | LocationType): string[] {
  const id = typeof location === "string" ? location : location.id;
  return [
    ...new Set([
      id,
      ...(typeof location === "string" || !location.watershedId
        ? []
        : [location.watershedId]),
      ...(id === "BurlingtonVT" ? ["RutlandVT", "WhiteRiverJunctionVT"] : []),
    ]),
  ];
}
