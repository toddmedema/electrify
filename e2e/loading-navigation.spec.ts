import { expect, test } from "./fixtures";

test.use({ serviceWorkers: "block" });

test("dismissing an achievement notification during loading leaves the next mission playable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("audioEnabled", "false");
  });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Inspect Coal", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "normal speed", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Mission complete!/ }),
  ).toBeVisible({ timeout: 60000 });
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  // Hold the next mission's data so card dismissal definitely precedes loaded().
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/data/**", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page
      .getByRole("button", { name: "Next tutorial", exact: true })
      .click();
    await page.clock.runFor(1000);
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: /Dismiss First Spark/ }).click();
    await expect(page.locator(".achievementToastPanel")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Achievements", exact: true }),
    ).toBeHidden();
    release();
    await page.clock.resume();
    // This objective appears only after loaded() and its delayed restoration both finish.
    await expect(
      page.getByRole("region", { name: "Step 1 of 10", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".facilities:visible")).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
