import { useSyncExternalStore } from "react";
import { achievementJournal } from "./Journal";

export function useAchievements() {
  return useSyncExternalStore(
    achievementJournal.subscribe,
    achievementJournal.getSnapshot,
    achievementJournal.getSnapshot,
  );
}
