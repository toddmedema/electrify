import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "./Globals";
import { isDesktopApp } from "./Desktop";
import { SCORE_VERSION } from "./helpers/Scoring";
import type { DifficultyType, ScoreType } from "./Types";

/** A short visit-to-visit cache, including successful empty boards. */
export const LEADERBOARD_FRESH_MS = 60_000;
export const BOARD_ROWS = 10;
interface Entry<T> {
  expires: number;
  value?: T;
  request?: Promise<T>;
}
const entries = new Map<string, Entry<unknown>>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = entries.get(key) as Entry<T> | undefined;
  if (existing?.request) return existing.request;
  if (existing && existing.expires > Date.now())
    return Promise.resolve(existing.value as T);
  const entry: Entry<T> = { expires: 0 };
  const request = load().then(
    (value) => {
      if (entries.get(key) === entry) {
        entry.value = value;
        entry.expires = Date.now() + LEADERBOARD_FRESH_MS;
        entry.request = undefined;
      }
      return value;
    },
    (error) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    },
  );
  entry.request = request;
  entries.set(key, entry);
  return request;
}
/** In-flight old results may finish for their caller, but cannot refill an invalidated cache. */
export function invalidateLeaderboards(): void {
  entries.clear();
}
export type LeaderboardScope = "global" | "friends" | "player";
function source() {
  return process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()
    ? "desktop"
    : "web";
}
export function loadLeaderboard(
  scenarioId: number,
  difficulty?: DifficultyType,
  scope: LeaderboardScope = "global",
  uid?: string,
): Promise<(ScoreType & { rank?: number })[]> {
  const native = source() === "desktop";
  const key = JSON.stringify([
    source(),
    SCORE_VERSION,
    scenarioId,
    difficulty,
    scope,
    scope === "player" || native ? uid : undefined,
  ]);
  return cached(key, async () => {
    if (native) {
      const { desktopScores } = await import("./DesktopScores");
      return desktopScores(
        scenarioId,
        difficulty,
        scope,
        difficulty ? (scope === "player" ? 1 : BOARD_ROWS) : 50,
      );
    }
    const snapshot = await getDocs(
      query(
        collection(getDb(), "scores"),
        where("scoreVersion", "==", SCORE_VERSION),
        where("outcome", "==", "completed"),
        where("scenarioId", "==", scenarioId),
        ...(difficulty ? [where("difficulty", "==", difficulty)] : []),
        ...(scope === "player" ? [where("uid", "==", uid)] : []),
        orderBy("score", "desc"),
        limit(difficulty ? (scope === "player" ? 1 : BOARD_ROWS) : 50),
      ),
    );
    return snapshot.docs.map((doc) => doc.data() as ScoreType);
  });
}
export function loadLeaderboardRank(
  scenarioId: number,
  difficulty: DifficultyType,
  score: number,
): Promise<number> {
  return cached(
    JSON.stringify([
      source(),
      SCORE_VERSION,
      scenarioId,
      difficulty,
      "rank",
      score,
    ]),
    async () => {
      if (source() === "desktop") {
        const { desktopScoreRank } = await import("./DesktopScores");
        return desktopScoreRank(scenarioId, difficulty, score);
      }
      const result = await getCountFromServer(
        query(
          collection(getDb(), "scores"),
          where("scoreVersion", "==", SCORE_VERSION),
          where("outcome", "==", "completed"),
          where("scenarioId", "==", scenarioId),
          where("difficulty", "==", difficulty),
          where("score", ">", score),
          orderBy("score", "desc"),
        ),
      );
      return result.data().count + 1;
    },
  );
}
