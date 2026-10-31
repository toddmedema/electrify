import type { LocationType } from "../Types";

/** One company weather record, plus its explicitly modeled watershed when present. */
export function weatherLocationIds(location: string | LocationType): string[] {
  const id = typeof location === "string" ? location : location.id;
  return [
    ...new Set([
      id,
      ...(typeof location === "string" || !location.watershedId
        ? []
        : [location.watershedId]),
    ]),
  ];
}
