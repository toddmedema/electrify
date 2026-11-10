import { useSyncExternalStore } from "react";
import { unlockedDifficulty } from "./DifficultyUnlocks";
import { achievementJournal } from "./Journal";

export function useAchievements() {
  return useSyncExternalStore(
    achievementJournal.subscribe,
    achievementJournal.getSnapshot,
    achievementJournal.getSnapshot,
  );
}

export function useUnlockedDifficulty() {
  return unlockedDifficulty(useAchievements().progress);
}
