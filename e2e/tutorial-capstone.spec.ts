import { expect, test } from "@playwright/test";

test("guided objective reaches a retryable capstone and succeeds", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();

  await expect(
    page.getByRole("heading", { name: "Mission objective" }),
  ).toBeVisible();
  await expect(page.getByText("Your goal: keep the lights on")).toBeVisible();

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
    await expect(page.locator(".desktop-layout")).toHaveCount(1);
    await expect(page.locator(".pane-layout")).toHaveCount(0);
  }

  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByText(/supply line must stay at or above the demand line/i),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Your plants make electricity")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Tap 1× to start time")).toBeVisible();

  if (testInfo.project.name.startsWith("mobile-")) {
    const speedButtons = page.locator("#speedChangeButtons button");
    for (let i = 0; i < (await speedButtons.count()); i++) {
      const box = await speedButtons.nth(i).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  }

  if (testInfo.project.name === "mobile-390px") {
    await expect(page.getByRole("button", { name: "Insights" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Events" })).toBeVisible();
  }

  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByText("Your turn: keep the lights on for a full day"),
  ).toBeVisible();

  // Remove firm capacity so the first attempt demonstrates consequence feedback and retry. The
  // objective is docked outside the game surface, so the same control remains operable at every
  // viewport without a small-screen workaround.
  const naturalGas = page.locator(".facilityRow", { hasText: "Natural Gas" });
  await naturalGas.click();
  await page.getByRole("button", { name: "Pause Natural Gas" }).click();
  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByRole("heading", { name: "Final challenge needs another try" }),
  ).toBeVisible();
  await expect(
    page.getByText("Demand exceeded available supply"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Retry final challenge" }).click();
  await expect(
    page.getByText("Your turn: keep the lights on for a full day"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause Natural Gas" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByRole("heading", { name: /Mission complete!/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next tutorial" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to main menu" }),
  ).toBeVisible();
});
