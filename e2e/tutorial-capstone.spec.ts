import { expect, test } from "./fixtures";

test("guided objective reaches a retryable capstone and succeeds", async ({
  page,
}, testInfo) => {
  await page.addInitScript(
    (theme) => {
      window.localStorage.clear();
      window.localStorage.setItem("theme", theme);
    },
    testInfo.project.name.startsWith("mobile-") ? "dark" : "light",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Step 1 of 4" }),
  ).toBeVisible();
  await expect(page.getByText("Tap your coal plant")).toBeVisible();
  // The first step is a new player's first look at the game, so everything it doesn't use
  // stays out of the way until a later step needs it
  await expect(page.locator("#navfooter")).toBeHidden();
  await expect(page.locator(".button-buildFacility")).toBeHidden();
  await expect(page.locator(".gameMenuButton")).toBeHidden();
  await expect(page.locator("#speedChangeButtons")).toBeHidden();

  const expectObjectiveDocked = async () => {
    const objective = page.locator(".tutorialHud");
    const game = page.locator(".cardTransitions");
    const [objectiveBox, gameBox] = await Promise.all([
      objective.boundingBox(),
      game.boundingBox(),
    ]);
    expect(objectiveBox).not.toBeNull();
    expect(gameBox).not.toBeNull();
    expect(objectiveBox!.y + objectiveBox!.height).toBeLessThanOrEqual(
      gameBox!.y + 1,
    );
    expect(
      await objective.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  };
  await expectObjectiveDocked();

  if (testInfo.project.name === "desktop-1440px") {
    await expect(page.locator(".gameWorkspace")).toHaveCount(1);
    // Mission 1 keeps the action dock for later: the fleet has the screen to itself.
    await expect(page.locator("#facilitiesPane")).toBeVisible();
    await expect(page.locator(".gameToolPanel")).toHaveCount(0);
    await expect(page.locator("#insightsPane")).toHaveCount(0);
    await expect(page.locator("#eventsPane")).toHaveCount(0);
  }

  await page.getByRole("button", { name: "Inspect Coal", exact: true }).click();
  await expect(
    page.locator(".tutorialHud").getByText("Tap the supply and demand chart"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect Coal", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.locator('[data-fuel="Coal"] .facilityDetails'),
  ).toBeVisible();
  await page.locator("#chartSupplyDemand").click();
  await expect(page.getByText("Tap 1× to start time")).toBeVisible();
  await expect(page.locator("#speedChangeButtons")).toBeVisible();

  if (testInfo.project.name.startsWith("mobile-")) {
    const speedButtons = page.locator("#speedChangeButtons button");
    for (let i = 0; i < (await speedButtons.count()); i++) {
      const box = await speedButtons.nth(i).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  }

  // Navigation belongs to later missions
  await expect(page.locator("#navfooter")).toBeHidden();

  await page.getByRole("button", { name: "normal speed" }).click();
  await expect(
    page.getByText("Reach midnight without a blackout"),
  ).toBeVisible();
  // The clock keeps running into the capstone, so stop it while the setup below is arranged
  await page.getByRole("button", { name: "pause", exact: true }).click();
  await expect(
    page.getByText("Watch coal output climb slowly as sunlight fades."),
  ).toBeVisible();
  await expect(page.locator(".tutorialHudHint")).toHaveCount(0);
  await expectObjectiveDocked();
  await page.screenshot({ path: testInfo.outputPath("capstone.png") });

  // Remove firm capacity so the first attempt demonstrates consequence feedback and retry. The
  // objective is docked outside the game surface, so the same control remains operable at every
  // viewport without a small-screen workaround.
  const coal = page.locator(".facilityRow", { hasText: "Coal" });
  await expect(
    coal.getByRole("button", { name: "Inspect Coal", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Pause Coal" }).click();
  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByRole("heading", { name: "Final challenge needs another try" }),
  ).toBeVisible();
  await expect(
    page.getByText("Demand exceeded available supply"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Retry final challenge" }).click();
  await expect(
    page.getByText("Reach midnight without a blackout"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Inspect Coal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause Coal" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume Coal", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByRole("heading", { name: /Mission complete!/ }),
  ).toBeVisible();
  // The handoff names the next mission and what it covers, so the player knows where they're going
  const completionDialog = page.getByRole("dialog");
  await expect(
    completionDialog.getByText("Up next: Mission 2: Generators"),
  ).toBeVisible();
  await expect(
    completionDialog.getByText("Build a generator", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next tutorial" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to main menu" }),
  ).toBeVisible();
});
