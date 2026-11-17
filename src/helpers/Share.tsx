import { formatScore } from "./Format";
import { SCENARIOS } from "../data/Scenarios";

// Sharing a score, which is the whole point of putting a name and a rank on the board. Kept out
// of Globals so the text builder can be tested without a DOM and the transport without Firebase.

export interface ShareScoreType {
  scenarioId?: number;
  score: number;
  scenarioName: string;
  difficulty: string;
}

export interface ShareContentType {
  title: string;
  text: string;
  url: string;
}

/**
 * How a share actually went. "cancelled" is deliberately distinct from "unavailable": a player who
 * opened the share sheet and backed out did not fail at anything, and should not be told they did.
 */
export type ShareResultType =
  "share" | "clipboard" | "cancelled" | "unavailable";

export function buildShareText({
  score,
  scenarioName,
  difficulty,
}: ShareScoreType): string {
  const formatted = formatScore(score);
  return `I scored ${formatted} running ${scenarioName} at ${difficulty} difficulty on Electrify - electrifygame.com`;
}

export function buildScoreShareContent(
  score: ShareScoreType,
): ShareContentType {
  const base =
    typeof window === "undefined"
      ? "https://electrifygame.com"
      : window.location.origin;
  const scenario = SCENARIOS.some(
    (s) => s.id === score.scenarioId && !s.tutorialSteps,
  )
    ? `scenario=${score.scenarioId}&`
    : "";
  const candidate = `${base}/?${scenario}utm_source=share`;
  return {
    title: `My ${score.scenarioName} score in Electrify`,
    text: buildShareText(score),
    url:
      candidate.length <= 2048
        ? candidate
        : `https://electrifygame.com/?${scenario}utm_source=share`,
  };
}

export { buildGameShareContent, canShare, shareText } from "./ShareTransport";
