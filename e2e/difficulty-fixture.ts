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
      localStorage.setItem(key, JSON.stringify(journal));
    },
    { key: DIFFICULTY_STORAGE_KEY, journal: unlockedJournal },
  );
}
