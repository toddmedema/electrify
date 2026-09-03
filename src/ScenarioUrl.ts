import { SCENARIOS } from "./data/Scenarios";
import { ScenarioType } from "./Types";

type LocationParts = Pick<Location, "pathname" | "search">;

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
  params.set("scenario", String(scenarioId));
  return `${location.pathname}?${params.toString()}`;
}

/** The scenario catalog is the parent route of every challenge details link. */
export function scenarioListUrl(
  location: LocationParts = window.location,
): string {
  const params = new URLSearchParams(location.search);
  params.delete("scenario");
  const search = params.toString();
  return `${location.pathname}${search ? `?${search}` : ""}`;
}
