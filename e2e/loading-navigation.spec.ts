import path from "node:path";
import catalog from "../src/achievements/AchievementCatalog.json";
import { expect, test } from "./fixtures";

test.use({ serviceWorkers: "block" });

test("a mission finishing its load cannot replace Achievements opened from a notification", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Inspect Coal", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "normal speed", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Mission complete!/ }),
  ).toBeVisible({ timeout: 60000 });
  await page.clock.install();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  // Hold the next mission's data so the notification click definitely precedes loaded().
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
    await page
      .getByRole("button", { name: "View achievements", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Achievements", exact: true }),
    ).toBeVisible();
    release();
    await page.clock.resume();
    // This objective appears only after loaded() and its delayed restoration both finish.
    await expect(
      page.getByRole("region", { name: "Step 1 of 9", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`1 of ${catalog.length} unlocked`, { exact: true }),
    ).toBeVisible();
    if (process.env.REVIEW_SCREENSHOT_DIR)
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `loading-gallery-${info.project.name}.png`,
        ),
        animations: "disabled",
      });
    // Back returns to the playable mission, not the loading screen or main menu.
    await page.keyboard.press("Escape");
    await expect(page.locator(".facilities:visible")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Step 1 of 9", exact: true }),
    ).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
