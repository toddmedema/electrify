/**
 * Dedicated, guided setup for visitors exploring data-center growth. Kept free of imports so the
 * card slice can read it while choosing its first screen without pulling in the scenario catalog.
 */
export function isDataCenterSetupSearch(search: string): boolean {
  return new URLSearchParams(search).get("dataCenters") === "1";
}
