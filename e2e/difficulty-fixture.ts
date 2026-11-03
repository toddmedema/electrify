import type { Page } from "@playwright/test";

export const DIFFICULTY_STORAGE_KEY = "electrify-achievements-v1";
export const unlockedJournal = {
  version: 1,
  guest: {
    version: 1,
    earned: [],
    tutorials: [],
    wins: ["100:Intern", "101:Employee", "100:Manager", "101:VP"],
  },
  accounts: {},
};

/** Flow specs choosing advanced rules represent a player who has earned each prior level. */
export async function unlockAllDifficulties(page: Page) {
  await page.addInitScript(
    ({ key, journal }) => {
      const deviceStorage = window.localStorage;
      const restoreProgress = () =>
        deviceStorage.setItem(key, JSON.stringify(journal));
      const clear = Storage.prototype.clear;
      Storage.prototype.clear = function () {
        clear.call(this);
        if (this === deviceStorage) restoreProgress();
      };
      // Specs reset preferences in their own init scripts, whose order is not guaranteed.
      restoreProgress();
    },
    { key: DIFFICULTY_STORAGE_KEY, journal: unlockedJournal },
  );
}
