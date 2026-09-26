import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

// With a mouse, resting on a (?) previews its entry and moving away dismisses it, without
// pinning it open or pausing the game. A click still pins the full popover.
test("a mouse previews manual entries on hover", async ({ page }, testInfo) => {
  test.skip(
    !!testInfo.project.use.hasTouch,
    "Hover previews are for mouse pointers",
  );
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("theme", "light");
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/?scenario=106");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const insights = page.locator(".insights:visible");
  await openPane(
    insights,
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  await insights
    .getByRole("button", { name: "Customer programs", exact: true })
    .click();
  const dialog = page.getByRole("dialog").first();
  await dialog
    .getByRole("button", { name: "Time-of-use tariff · Off", exact: true })
    .click();
  const help = page.getByRole("button", { name: "What is Customer programs?" });
  await help.hover();
  const previewBox = page.getByRole("dialog", { name: "Manual preview" });
  await expect(previewBox).toBeVisible();
  // Hovering doesn't pin the entry
  await expect(page.getByRole("dialog", { name: "Manual help" })).toHaveCount(
    0,
  );
  // Move onto the preview and scroll it: stays open
  const box = (await previewBox.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(600);
  await expect(previewBox).toBeVisible();
  // Move away: disappears, game dialog untouched
  await page.mouse.move(5, 5, { steps: 5 });
  await expect(previewBox).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Manual help" })).toHaveCount(
    0,
  );
  // Click still pins
  await help.click();
  await expect(page.getByRole("dialog", { name: "Manual help" })).toBeVisible();
  await expect(previewBox).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Manual help" })).toHaveCount(
    0,
  );
  // The mouse is still on the (?), but closing shouldn't bring the preview straight back
  await page.waitForTimeout(800);
  await expect(previewBox).toHaveCount(0);
});
