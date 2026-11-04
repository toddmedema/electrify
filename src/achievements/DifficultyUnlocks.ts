import { DIFFICULTY_IDS, DIFFICULTY_LABELS } from "../Constants";
import type { DifficultyType } from "../Types";
import type { AchievementRecord } from "./Progress";

/** Each rung needs its own official scenario win; a higher win cannot skip a missing rung. */
export function unlockedDifficulty(
  progress: AchievementRecord,
): DifficultyType {
  let unlocked: DifficultyType = "Intern";
  for (const difficulty of DIFFICULTY_IDS.slice(0, -1)) {
    if (!progress.wins.some((win) => win.endsWith(`:${difficulty}`))) break;
    unlocked = DIFFICULTY_IDS[DIFFICULTY_IDS.indexOf(difficulty) + 1];
  }
  return unlocked;
}

export function difficultyLockReason(
  difficulty: DifficultyType,
  unlockedThrough: DifficultyType,
): string | undefined {
  const index = DIFFICULTY_IDS.indexOf(difficulty);
  if (index <= DIFFICULTY_IDS.indexOf(unlockedThrough)) return undefined;
  return `Complete an official scenario on ${DIFFICULTY_LABELS[DIFFICULTY_IDS[index - 1]]} to unlock ${DIFFICULTY_LABELS[difficulty]}.`;
}

/** Resolve stale preferences before both previewing and starting a new run. */
export function playableDifficulty(
  requested: DifficultyType,
  unlockedThrough: DifficultyType,
): DifficultyType {
  return difficultyLockReason(requested, unlockedThrough)
    ? unlockedThrough
    : requested;
}
