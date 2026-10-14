import { AchievementJournal, ACHIEVEMENT_STORAGE_KEY } from "./Journal";
import { emptyRecord, recordIntent } from "./Progress";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
const first = () =>
  recordIntent({
    earned: ["FIRST_SPARK"],
    completion: { scenarioId: 0, difficulty: "Intern" },
  });

test("guest awards survive reload, transfer once on login and stay isolated across accounts", () => {
  const storage = memoryStorage();
  let journal = new AchievementJournal(() => storage);
  journal.merge(first(), true);
  expect(journal.getSnapshot().notifications).toEqual(["FIRST_SPARK"]);
  journal = new AchievementJournal(() => storage);
  expect(journal.getSnapshot().progress.earned).toEqual(["FIRST_SPARK"]);
  expect(journal.getSnapshot().notifications).toEqual([]);
  journal.activate("alice");
  expect(journal.getSnapshot().progress.earned).toEqual(["FIRST_SPARK"]);
  journal.activate();
  expect(journal.getSnapshot().progress).toEqual(emptyRecord());
  journal.activate("bob");
  expect(journal.getSnapshot().progress).toEqual(emptyRecord());
  journal.merge(recordIntent({ earned: ["OUT_OF_JUICE"] }));
  journal.activate("alice");
  expect(journal.getSnapshot().progress.earned).toEqual(["FIRST_SPARK"]);
  expect(JSON.parse(storage.getItem(ACHIEVEMENT_STORAGE_KEY)!).guest).toEqual(
    emptyRecord(),
  );
});

test("stale tabs see claimed guest history and preserve other account writes", () => {
  const storage = memoryStorage();
  const one = new AchievementJournal(() => storage);
  one.merge(first());
  const two = new AchievementJournal(() => storage);
  one.activate("alice");
  two.activate("bob");
  expect(two.getSnapshot().progress).toEqual(emptyRecord());
  two.merge(recordIntent({ earned: ["OUT_OF_JUICE"] }));
  one.merge(recordIntent({ earned: ["LIGHTS_ON"] }));
  two.refresh();
  expect(two.getSnapshot().progress.earned).toEqual(["OUT_OF_JUICE"]);
  two.activate("alice");
  expect(two.getSnapshot().progress.earned).toEqual([
    "FIRST_SPARK",
    "LIGHTS_ON",
  ]);
});

test("storage failures retain live awards and can persist them later without duplicate notifications", () => {
  const storage = memoryStorage();
  let blocked = true;
  const journal = new AchievementJournal(() => ({
    ...storage,
    setItem: (key, value) => {
      if (blocked) throw new Error("Quota exceeded");
      storage.setItem(key, value);
    },
  }));
  journal.merge(first(), true);
  expect(journal.getSnapshot().storageAvailable).toBe(false);
  expect(journal.getSnapshot().progress.earned).toEqual(["FIRST_SPARK"]);
  blocked = false;
  journal.retryStorage();
  expect(journal.getSnapshot().storageAvailable).toBe(true);
  journal.merge(first(), true);
  expect(journal.getSnapshot().notifications).toEqual(["FIRST_SPARK"]);
  expect(
    new AchievementJournal(() => storage).getSnapshot().progress.earned,
  ).toEqual(["FIRST_SPARK"]);
});

test("a failed guest claim cannot be claimed again by a later account", () => {
  const storage = memoryStorage();
  const journal = new AchievementJournal(() => storage);
  journal.merge(first());
  const write = storage.setItem;
  storage.setItem = () => {
    throw new Error("Quota exceeded");
  };
  journal.activate("alice");
  journal.activate("bob");
  expect(journal.getSnapshot().progress).toEqual(emptyRecord());
  storage.setItem = write;
  journal.retryStorage();
  const restored = new AchievementJournal(() => storage);
  restored.activate("bob");
  expect(restored.getSnapshot().progress).toEqual(emptyRecord());
  restored.activate("alice");
  expect(restored.getSnapshot().progress.earned).toEqual(["FIRST_SPARK"]);
});

test("cloud restores are quiet and Steam availability suppresses the web queue", () => {
  const storage = memoryStorage();
  const journal = new AchievementJournal(() => storage);
  journal.merge(first());
  expect(journal.getSnapshot().notifications).toEqual([]);
  journal.setSteamAvailable(true);
  journal.merge(recordIntent({ earned: ["OUT_OF_JUICE"] }), true);
  expect(journal.getSnapshot().notifications).toEqual([]);
  journal.setSteamAvailable(false);
  journal.merge(recordIntent({ earned: ["LIGHTS_ON"] }), true);
  expect(journal.getSnapshot().notifications).toEqual(["LIGHTS_ON"]);
  journal.dismiss("LIGHTS_ON");
  expect(journal.getSnapshot().notifications).toEqual([]);
});
