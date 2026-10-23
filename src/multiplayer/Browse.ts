import { DIFFICULTY_IDS } from "../Constants";
import { CUSTOM_SCENARIO_ID, getScenario } from "../data/Scenarios";
import { storyHash } from "../data/WorldEvents";
import { getScenarioLocation, isValidLocation } from "../helpers/Locations";
import type { DifficultyType, ScenarioType } from "../Types";
import type { MatchSpec } from "./Types";
import {
  validModBrowseSummary,
  validSelectedMod,
  type ModBrowseSummary,
} from "./ModBrowse";
import { utf8Bytes } from "../helpers/RuleIdentity";

/** The selection screens a lobby browses together, in the order a host usually visits them. */
export const BROWSE_CARDS = [
  "NEW_GAME",
  "NEW_GAME_DETAILS",
  "CUSTOM_GAME",
  "MODS",
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
  /** Community selection facts only; its frozen snapshot has a separate bounded transfer. */
  mod?: ModBrowseSummary;
}
export type HostBrowseSelection = Omit<BrowseState, "session" | "revision"> & {
  scenarioSnapshot?: ScenarioType;
};

/** The match the host would start from this selection, if it names one. */
export function browseSpec(
  browse: BrowseState,
  snapshot?: ScenarioType,
): MatchSpec | undefined {
  if (browse.mod)
    return snapshot && validSelectedMod(browse.mod, snapshot)
      ? {
          scenarioId: CUSTOM_SCENARIO_ID,
          difficulty: browse.difficulty,
          customScenario: snapshot,
        }
      : undefined;
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
  if (browse.mod)
    return `mod|${browse.difficulty}|${browse.mod.seed}|${browse.mod.packageDigest}|${browse.mod.runtimeDigest}`;
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
    custom.mod === undefined &&
    custom.rules === undefined &&
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
  try {
    if (utf8Bytes(JSON.stringify(value)).length > 16 * 1024) return false;
  } catch {
    return false;
  }
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "session",
          "revision",
          "phase",
          "card",
          "scenarioId",
          "difficulty",
          "custom",
          "mod",
        ].includes(key),
    )
  )
    return false;
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
    (browse.custom === undefined || validCustom(browse.custom)) &&
    (browse.mod === undefined ||
      (browse.card === "MODS" &&
        browse.custom === undefined &&
        validModBrowseSummary(browse.mod) &&
        browse.mod.difficulty === browse.difficulty))
  );
}
