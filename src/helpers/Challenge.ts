import { ChallengeInvitationV1, VictoryType } from "../Types";
import {
  expandAuthoredRunReference,
  projectAuthoredRunReference,
  sameRunIdentity,
} from "./RunIdentity";
import { buildScoreShareContent, ShareContentType } from "./Share";
import { DIFFICULTY_LABELS } from "../Constants";
import { SCENARIOS } from "../data/Scenarios";

export const MAX_CHALLENGE_URL = 2048;
export type ChallengeRoute = {
  invitation?: ChallengeInvitationV1;
  scenarioId?: number;
  error?: string;
};
export function validInvitation(raw: unknown): raw is ChallengeInvitationV1 {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as ChallengeInvitationV1;
  return (
    Object.keys(value).sort().join() === "invitationSchemaVersion,run,target" &&
    value.invitationSchemaVersion === 1 &&
    Number.isSafeInteger(value.target) &&
    !!expandAuthoredRunReference(value.run)
  );
}
export function parseChallengeUrl(href: string): ChallengeRoute | undefined {
  let url: URL;
  try {
    url = new URL(href, "https://electrifygame.com");
  } catch (_error) {
    return { error: "This challenge link is invalid." };
  }
  if (!url.searchParams.has("challenge")) return;
  const failed: ChallengeRoute = {
    error:
      "This challenge link is invalid or uses different conditions. Choose a current mission.",
  };
  if (
    href.length > MAX_CHALLENGE_URL ||
    url.searchParams.getAll("challenge").length !== 1
  )
    return failed;
  try {
    const value: unknown = JSON.parse(url.searchParams.get("challenge")!);
    if (value && typeof value === "object") {
      const id = (value as ChallengeInvitationV1).run?.scenarioId;
      if (SCENARIOS.some((s) => s.id === id && !s.tutorialSteps))
        failed.scenarioId = id;
    }
    if (!validInvitation(value)) return failed;
    const scenarioKeys = url.searchParams.getAll("scenario");
    if (
      scenarioKeys.length > 1 ||
      (scenarioKeys.length === 1 &&
        scenarioKeys[0] !== String(value.run.scenarioId))
    )
      return failed;
    return { invitation: value, scenarioId: value.run.scenarioId };
  } catch (_error) {
    return failed;
  }
}
export function challengeUrl(
  invitation: ChallengeInvitationV1,
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
  const reference = projectAuthoredRunReference(victory.runIdentity);
  const invitation: ChallengeInvitationV1 | undefined =
    reference && Number.isSafeInteger(victory.score)
      ? { invitationSchemaVersion: 1, run: reference, target: victory.score }
      : undefined;
  const url = invitation && challengeUrl(invitation, href);
  if (!url)
    return { content: buildScoreShareContent(victory), challenge: false };
  const scenario = SCENARIOS.find((s) => s.id === reference!.scenarioId)!;
  const reliability = victory.debrief;
  const story =
    reliability && (reliability.demandWh ?? 0) > 0
      ? `I served ${(Math.max(0, Math.min(reliability.reliability, 1)) * 100).toFixed(1)}% of electricity demand`
      : "I finished a run";
  return {
    challenge: true,
    content: {
      title: `Challenge a friend: ${scenario.name}`,
      text: `${story} in ${scenario.name} on ${DIFFICULTY_LABELS[victory.difficulty]}. My score: ${victory.score.toLocaleString("en-US")}. Can you beat it?`,
      url,
    },
  };
}
export function challengeComparison(victory: VictoryType): string | undefined {
  const invitation = victory.challenge;
  if (!invitation) return;
  if (
    !sameRunIdentity(
      victory.runIdentity,
      expandAuthoredRunReference(invitation.run),
    )
  )
    return "Conditions differ — scores cannot be compared.";
  const difference = BigInt(victory.score) - BigInt(invitation.target);
  return difference === BigInt(0)
    ? "You tied the shared score."
    : difference > BigInt(0)
      ? `You beat the shared score by ${difference.toLocaleString("en-US")} points.`
      : `You finished ${(-difference).toLocaleString("en-US")} points below the shared score.`;
}
