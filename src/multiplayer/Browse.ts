import { DIFFICULTY_IDS } from "../Constants";
import { CUSTOM_SCENARIO_ID, getScenario } from "../data/Scenarios";
import { storyHash } from "../data/WorldEvents";
import { getScenarioLocation, isValidLocation } from "../helpers/Locations";
import type { DifficultyType, ScenarioType } from "../Types";
import type { MatchSpec } from "./Types";

/** The selection screens a lobby browses together, in the order a host usually visits them. */
export const BROWSE_CARDS = [
  "NEW_GAME",
  "NEW_GAME_DETAILS",
  "CUSTOM_GAME",
] as const;
export type BrowseCard = (typeof BROWSE_CARDS)[number];

const MAX_CUSTOM_FACILITIES = 40;

/** What the host is looking at, mirrored to every guest. The host is its only author. */
export interface BrowseState {
  /** Random per lobby session; a new one replaces everything a guest held. */
  session: string;
  /** Increases with every change, so a guest drops anything older. */
  revision: number;
  /** "playing" while a match runs; "browsing" while choosing, including back in the lobby. */
  phase: "browsing" | "playing";
  card: BrowseCard;
  /** The authored scenario on the details screen. */
  scenarioId?: number;
  difficulty: DifficultyType;
  /** The custom game being set up. */
  custom?: ScenarioType;
}

/** The match the host would start from this selection, if it names one. */
export function browseSpec(browse: BrowseState): MatchSpec | undefined {
  if (browse.card === "CUSTOM_GAME" && browse.custom)
    return {
      scenarioId: CUSTOM_SCENARIO_ID,
      difficulty: browse.difficulty,
      customScenario: browse.custom,
    };
  if (browse.card === "NEW_GAME_DETAILS" && browse.scenarioId !== undefined)
    return { scenarioId: browse.scenarioId, difficulty: browse.difficulty };
  return undefined;
}

/**
 * A short stamp of exactly what a guest agreed to. Ready is stored as this stamp, so any change
 * to the scenario, difficulty or custom settings clears it without another message.
 */
export function selectionKey(browse: BrowseState): string {
  const spec = browseSpec(browse);
  if (!spec) return "";
  const custom = spec.customScenario
    ? (storyHash(JSON.stringify(spec.customScenario)) >>> 0).toString(36)
    : "";
  return `${spec.scenarioId}|${spec.difficulty}|${custom}`;
}

const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);

/** A custom game a guest can render and forecast; the host's start validates it in full. */
function validCustom(value: unknown): value is ScenarioType {
  if (!value || typeof value !== "object") return false;
  const custom = value as ScenarioType;
  return (
    custom.id === CUSTOM_SCENARIO_ID &&
    custom.modPackage === undefined &&
    typeof custom.name === "string" &&
    Number.isSafeInteger(custom.startingYear) &&
    Number.isSafeInteger(custom.durationMonths) &&
    custom.durationMonths > 0 &&
    finite(custom.cash) &&
    finite(custom.dollarsPerkWh) &&
    Array.isArray(custom.facilities) &&
    custom.facilities.length <= MAX_CUSTOM_FACILITIES &&
    isValidLocation(getScenarioLocation(custom))
  );
}

/** Validates an untrusted selection from the wire before any screen renders it. */
export function validBrowseState(value: unknown): value is BrowseState {
  if (!value || typeof value !== "object") return false;
  const browse = value as BrowseState;
  return (
    typeof browse.session === "string" &&
    browse.session.length > 0 &&
    browse.session.length <= 64 &&
    Number.isSafeInteger(browse.revision) &&
    browse.revision >= 0 &&
    (browse.phase === "browsing" || browse.phase === "playing") &&
    (BROWSE_CARDS as readonly string[]).includes(browse.card) &&
    DIFFICULTY_IDS.includes(browse.difficulty) &&
    (browse.scenarioId === undefined ||
      (Number.isSafeInteger(browse.scenarioId) &&
        !getScenario(browse.scenarioId)?.tutorialSteps &&
        !!getScenario(browse.scenarioId))) &&
    (browse.custom === undefined || validCustom(browse.custom))
  );
}
