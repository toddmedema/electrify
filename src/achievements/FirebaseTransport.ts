import { measureFirestoreRead } from "../FirestoreReads";
import { doc, runTransaction } from "firebase/firestore";
import { getDb } from "../Globals";
import { emptyRecord, mergeRecords, validRecord } from "./Progress";
import type { AchievementRecord } from "./Progress";

export interface AchievementTransport {
  merge(
    uid: string,
    local: AchievementRecord,
    current: () => boolean,
  ): Promise<AchievementRecord>;
}
export class FirebaseAchievementTransport implements AchievementTransport {
  async merge(uid: string, local: AchievementRecord, current: () => boolean) {
    const ref = doc(getDb(), "users", uid, "achievementProgress", "current");
    return runTransaction(getDb(), async (transaction) => {
      const snapshot = await measureFirestoreRead(
        "achievement.transaction",
        () => transaction.get(ref),
        (snapshot) => (snapshot.exists() ? 1 : 0),
      );
      if (!current()) throw new Error("Achievement account changed");
      const remote: unknown = snapshot.exists()
        ? snapshot.data()
        : emptyRecord();
      if (!validRecord(remote))
        throw new Error("Invalid cloud achievement history");
      const merged = mergeRecords(remote, local);
      if (
        JSON.stringify([remote.earned, remote.tutorials, remote.wins]) !==
        JSON.stringify([merged.earned, merged.tutorials, merged.wins])
      )
        transaction.set(ref, merged);
      return merged;
    });
  }
}
