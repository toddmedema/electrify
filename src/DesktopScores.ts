import { getDesktop } from "./Desktop";
import { APP_VERSION } from "./AppVersion";
import type { DifficultyType, ScoreType, VictoryType, UserType } from "./Types";
import { competitiveBestKey, SCORE_VERSION } from "./helpers/Scoring";
import type { SaveRepository } from "./SaveRepository";
import { SCENARIOS } from "./data/Scenarios";
import manifest from "./data/RunCompatibility.json";
import { Timestamp } from "firebase/firestore";

/** Restore only explicitly current completed official results after a Steam restart. */
export async function readDesktopCompetitiveBests(
  repository: Pick<SaveRepository, "list" | "read">,
): Promise<NonNullable<UserType["bests"]>> {
  const bests: NonNullable<UserType["bests"]> = {};
  for (const entry of await repository.list()) {
    try {
      const { result, save } = await repository.read(entry.id);
      if (
        !result ||
        result.scoreVersion !== SCORE_VERSION ||
        result.outcome !== "completed" ||
        entry.status !== "completed" ||
        save.game.replayPlayback ||
        !SCENARIOS.some(
          (scenario) =>
            scenario.id === result.scenarioId && !scenario.tutorialSteps,
        )
      )
        continue;
      const key = competitiveBestKey(result.scenarioId);
      if (result.score > (bests[key]?.score ?? -Infinity))
        bests[key] = {
          scoreVersion: SCORE_VERSION,
          score: result.score,
          difficulty: result.difficulty,
          date: Date.parse(entry.savedAt),
        };
    } catch {
      /* A damaged historical save cannot prevent playing. */
    }
  }
  return bests;
}

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
    scoreVersion: SCORE_VERSION,
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
  outcome: NonNullable<VictoryType["outcome"]>;
  scenarioId: number;
  difficulty: DifficultyType;
  score: number;
}): Promise<void> {
  if (submission.outcome !== "completed") return;
  const request = (async () => {
    await getDesktop()?.submitScore({
      ...submission,
      appVersion: APP_VERSION,
      challengeId: manifest.compatibilityId,
      scoreVersion: SCORE_VERSION,
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
      scoreVersion: SCORE_VERSION,
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
