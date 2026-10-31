import { expect, Page, test } from "./fixtures";

async function reachStartTimeStep(page: Page) {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Inspect Coal", exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();
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
    page.getByText("Reach midnight without a blackout"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "normal speed" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("Exit returns directly to the main menu and remembers the tutorial visit", async ({
  page,
}) => {
  await reachStartTimeStep(page);
  await page
    .locator(".tutorialHud")
    .getByRole("button", { name: "Exit", exact: true })
    .click();
  await expect(page.locator(".tutorialHud")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".snackbarContent")).toBeHidden();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a game" }),
  ).toBeVisible();
});

for (const explicitlyExit of [false, true]) {
  test(`main menu records completion only after explicit Exit (exit=${explicitlyExit})`, async ({
    page,
  }) => {
    await reachStartTimeStep(page);
    await page
      .getByRole("button", { name: "normal speed", exact: true })
      .click();
    await expect(
      page.getByText("Reach midnight without a blackout"),
    ).toBeVisible();
    await page.getByRole("button", { name: "pause", exact: true }).click();
    if (explicitlyExit) {
      await page
        .locator(".tutorialHud")
        .getByRole("button", { name: "Exit", exact: true })
        .click();
      await expect(page.locator(".tutorialHud")).toBeHidden();
    }
    if (!explicitlyExit) {
      await page.getByRole("button", { name: "menu", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "Main menu", exact: true })
        .click();
    }
    await page.getByRole("button", { name: "Play", exact: true }).click();
    if (explicitlyExit) {
      await expect(
        page.getByRole("heading", { name: "Choose a game" }),
      ).toBeVisible();
    } else {
      await expect(page.getByText("Tap your coal plant")).toBeVisible();
    }
  });
}
