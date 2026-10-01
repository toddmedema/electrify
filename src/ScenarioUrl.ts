import { SCENARIOS } from "./data/Scenarios";
import { ScenarioType } from "./Types";

type LocationParts = Pick<Location, "pathname" | "search">;

/** Dedicated, guided setup for visitors exploring data-center growth. */
export function isDataCenterSetupSearch(search: string): boolean {
  return new URLSearchParams(search).get("dataCenters") === "1";
}

/** Opens custom setup with one supported scenario event selected. */
export function customEventFromSearch(search: string): number | undefined {
  const rawId = new URLSearchParams(search).get("customEvent");
  if (rawId === null || !/^\d+$/.test(rawId)) return undefined;
  return SCENARIOS.find(
    (scenario) => scenario.id === Number(rawId) && !scenario.tutorialSteps,
  )?.id;
}

/** Resolves a public challenge details link without letting tutorial ids bypass the mission flow. */
export function scenarioFromSearch(search: string): ScenarioType | undefined {
  const rawId = new URLSearchParams(search).get("scenario");
  if (rawId === null || !/^\d+$/.test(rawId)) {
    return undefined;
  }

  const scenarioId = Number(rawId);
  return SCENARIOS.find(
    (scenario) => scenario.id === scenarioId && !scenario.tutorialSteps,
  );
}

/** Keeps unrelated query parameters intact while making the selected challenge shareable. */
export function scenarioDetailsUrl(
  scenarioId: number,
  location: LocationParts = window.location,
): string {
  const params = new URLSearchParams(location.search);
  params.delete("challenge");
  params.delete("customEvent");
  params.delete("dataCenters");
  params.set("scenario", String(scenarioId));
  return `${location.pathname}?${params.toString()}`;
}

/** The scenario catalog is the parent route of every challenge details link. */
export function scenarioListUrl(
  location: LocationParts = window.location,
): string {
  const params = new URLSearchParams(location.search);
  params.delete("scenario");
  params.delete("challenge");
  params.delete("customEvent");
  params.delete("dataCenters");
  const search = params.toString();
  return `${location.pathname}${search ? `?${search}` : ""}`;
}
