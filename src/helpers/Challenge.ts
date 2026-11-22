import { formatNumber } from "./Format";
import { ChallengeInvitation, VictoryType } from "../Types";
import { validRunIdentity } from "./RunIdentity";
import {
  challengeScenario,
  readLegacyInvitation,
  validInvitation,
} from "./ChallengeInvitation";
import { buildScoreShareContent, ShareContentType } from "./Share";
import { DIFFICULTY_LABELS } from "../Constants";
export const MAX_CHALLENGE_URL = 2048;
export type ChallengeRoute = {
  invitation?: ChallengeInvitation;
  scenarioId?: number;
  error?: string;
};
export function parseChallengeUrl(href: string): ChallengeRoute | undefined {
  let url: URL;
  try {
    url = new URL(href, "https://electrifygame.com");
  } catch (_error) {
    return { error: "This challenge link is invalid." };
  }
  if (!url.searchParams.has("challenge")) return;
  const failed: ChallengeRoute = {
    error: "This challenge link is invalid. Choose a current game.",
  };
  if (
    href.length > MAX_CHALLENGE_URL ||
    url.searchParams.getAll("challenge").length !== 1
  )
    return failed;
  try {
    const value: unknown = JSON.parse(url.searchParams.get("challenge")!);
    const legacy = readLegacyInvitation(value);
    const invitation = legacy
      ? {
          scenarioId: legacy.run.scenarioId,
          difficulty: legacy.run.difficulty,
          target: legacy.target,
        }
      : value;
    if (
      invitation &&
      typeof invitation === "object" &&
      "scenarioId" in invitation
    )
      failed.scenarioId = challengeScenario(invitation.scenarioId)?.id;
    if (!validInvitation(invitation)) return failed;
    const scenarioKeys = url.searchParams.getAll("scenario");
    if (
      scenarioKeys.length > 1 ||
      (scenarioKeys.length === 1 &&
        scenarioKeys[0] !== String(invitation.scenarioId))
    )
      return failed;
    return { invitation, scenarioId: invitation.scenarioId };
  } catch (_error) {
    return failed;
  }
}
export function challengeUrl(
  invitation: ChallengeInvitation,
  href = window.location.href,
): string | undefined {
  if (!validInvitation(invitation)) return;
  let url: URL;
  try {
    url = new URL(href);
  } catch (_error) {
    return;
  }
  url.hash = "";
  url.searchParams.delete("scenario");
  url.searchParams.set("challenge", JSON.stringify(invitation));
  url.searchParams.set("utm_source", "share");
  return url.href.length <= MAX_CHALLENGE_URL ? url.href : undefined;
}
export function challengeShareContent(
  victory: VictoryType,
  href?: string,
): { content: ShareContentType; challenge: boolean } {
  const { scenarioId, difficulty, score: target } = victory;
  const scenario = challengeScenario(scenarioId);
  const url =
    victory.outcome === "completed" &&
    validRunIdentity(victory.runIdentity) &&
    victory.runIdentity.scenarioId === scenarioId &&
    victory.runIdentity.difficulty === difficulty &&
    challengeUrl({ scenarioId, difficulty, target }, href);
  if (!scenario || !url)
    return { content: buildScoreShareContent(victory), challenge: false };
  const reliability = victory.debrief;
  const story =
    reliability && (reliability.demandWh ?? 0) > 0
      ? `I served ${formatNumber(Math.max(0, Math.min(reliability.reliability, 1)) * 100)}% of electricity demand`
      : "I finished a run";
  return {
    challenge: true,
    content: {
      title: `Challenge a friend: ${scenario.name}`,
      text: `${story} in ${scenario.name} on ${DIFFICULTY_LABELS[victory.difficulty]}. My score: ${formatNumber(victory.score)}. Can you beat it?`,
      url,
    },
  };
}
export function challengeComparison(victory: VictoryType): string | undefined {
  const invitation = victory.challenge;
  if (!invitation) return;
  if (victory.outcome !== "completed")
    return "Complete the mission to compare your score with the shared score.";
  if (
    victory.scenarioId !== invitation.scenarioId ||
    victory.difficulty !== invitation.difficulty
  )
    return "Compare scores on the same scenario and difficulty.";
  const difference = BigInt(victory.score) - BigInt(invitation.target);
  return difference === BigInt(0)
    ? "You tied the shared score."
    : difference > BigInt(0)
      ? `You beat the shared score by ${formatNumber(difference)} points.`
      : `You finished ${formatNumber(-difference)} points below the shared score.`;
}
