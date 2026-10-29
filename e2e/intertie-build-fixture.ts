import { expect, Page } from "@playwright/test";
import { editSavedGame, readSavedGame } from "./save-fixture";

/** Keep both routes available for catalog comparisons; the mission starts with one owned. */
export async function startIntertieBuildFixture(page: Page): Promise<void> {
  await page.goto("/?scenario=111");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect.poll(async () => Boolean(await readSavedGame(page))).toBe(true);
  await editSavedGame(page, ({ game }) => {
    game.transmission!.lines = [];
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}
