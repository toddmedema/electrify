import { expect, Page, test } from "@playwright/test";

async function reachStartTimeStep(page: Page) {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await expect(page.getByText("Tap 1× to start time")).toBeVisible();
}

// Regression test. Entering Mission 1's capstone rebuilt the scenario, which reloaded the game
// and paused the clock the player had just started with 1x
test("tapping 1x carries a running clock into Mission 1's final step", async ({
  page,
}) => {
  await reachStartTimeStep(page);
  await page.getByRole("button", { name: "normal speed" }).click();
  await expect(
    page.getByText("Keep the lights on for a full day"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "normal speed" }),
  ).toHaveAttribute("aria-pressed", "true");
});

// Regression test. The snackbar's swipe handler captured every press, so neither of its buttons
// ever received a click, and leaving Mission 1 early never counted it - which sent Start playing
// straight back into it
test("closing a walkthrough offers a working way to the missions", async ({
  page,
}) => {
  await reachStartTimeStep(page);
  await page
    .locator(".tutorialHud")
    .getByRole("button", { name: "Exit" })
    .click();

  const snackbar = page.locator(".snackbarContent");
  await expect(snackbar).toContainText("Walkthrough closed");
  const missions = snackbar.getByRole("button", { name: "Missions" });
  // The close button only shows on wide screens; narrower ones swipe the snackbar away
  const close = snackbar.getByRole("button", {
    name: "Dismiss notification",
  });
  if (await close.isVisible()) {
    const [missionsBox, closeBox] = await Promise.all([
      missions.boundingBox(),
      close.boundingBox(),
    ]);
    expect(missionsBox!.x + missionsBox!.width).toBeLessThanOrEqual(
      closeBox!.x,
    );
  }

  await missions.click();
  await expect(
    page.getByRole("heading", { name: "Choose a game" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "back" }).click();
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Choose a game" }),
  ).toBeVisible();
});
