import { getDesktop } from "./Desktop";
import { APP_VERSION } from "./AppVersion";
import type { DifficultyType, ScoreType } from "./Types";
import manifest from "./data/RunCompatibility.json";
import { Timestamp } from "firebase/firestore";

export async function desktopScores(
  scenarioId: number,
  difficulty: DifficultyType | undefined,
  scope: "global" | "friends" | "player",
): Promise<ScoreType[]> {
  const desktop = getDesktop();
  if (!desktop) return [];
  const entries = await desktop.getLeaderboard({
    scenarioId,
    difficulty,
    scope,
    challengeId: manifest.compatibilityId,
  });
  return entries.map((entry) => ({
    ...entry,
    uid: `steam:${entry.steamId}`,
    date: Timestamp.fromMillis(0),
    scoreBreakdown: {},
  }));
}
// Submissions still in flight, so a rank lookup for a just-finished run can wait for its score.
const submissions = new Set<Promise<void>>();
export async function submitDesktopScore(submission: {
  scenarioId: number;
  difficulty: DifficultyType;
  score: number;
}): Promise<void> {
  const request = (async () => {
    await getDesktop()?.submitScore({
      ...submission,
      appVersion: APP_VERSION,
      challengeId: manifest.compatibilityId,
    });
  })();
  submissions.add(request);
  try {
    await request;
  } finally {
    submissions.delete(request);
  }
}

const RANK_ATTEMPTS = 4;
const RANK_RETRY_MS = 1000;
/**
 * Steam keeps one score per player, so a rank exists only for a run that is the player's best.
 * The victory dialog can ask before the run's own submission has reached Steam; retry briefly.
 */
export async function desktopGlobalRank(
  scenarioId: number,
  difficulty: DifficultyType,
  score: number,
): Promise<number> {
  const target = Math.round(score);
  for (let attempt = 1; attempt <= RANK_ATTEMPTS; attempt++) {
    await Promise.allSettled([...submissions]);
    const scores = await getDesktop()?.getLeaderboard({
      scenarioId,
      difficulty,
      scope: "player",
      challengeId: manifest.compatibilityId,
    });
    const entry = scores?.[0];
    if (entry && entry.score === target && entry.rank) return entry.rank;
    if (entry && entry.score > target)
      throw new Error("This run is not your best Steam score.");
    if (attempt < RANK_ATTEMPTS)
      await new Promise((resolve) => setTimeout(resolve, RANK_RETRY_MS));
  }
  throw new Error("Steam rank is unavailable.");
}
