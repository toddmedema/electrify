import { expect, Page, test } from "./fixtures";
import { openBuild } from "./layout";

async function openWorkspaceHelp(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("theme", "light");
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/?scenario=111");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const build = await openBuild(page);
  const option = build.locator(".buildOption").first();
  await option.getByRole("button", { name: /^Show .* details$/ }).click();
  const help = option.getByRole("button", { name: /^What is / }).first();
  await expect(help).toBeVisible();
  return { build, help };
}

test("a mouse previews manual entries without leaving the workspace on Escape", async ({
  page,
}, testInfo) => {
  test.skip(
    !!testInfo.project.use.hasTouch,
    "Hover previews are for mouse pointers",
  );
  const { build, help } = await openWorkspaceHelp(page);
  // Hover does not move keyboard focus; Escape may come from elsewhere in the workspace.
  await build.getByRole("heading", { name: "Build", exact: true }).focus();
  await help.hover();
  const preview = page.getByRole("dialog", { name: "Manual preview" });
  const pinned = page.getByRole("dialog", { name: "Manual help" });
  await expect(preview).toBeVisible();
  await expect(pinned).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(build).toBeVisible();
  await expect(help).toBeVisible();
  await page.waitForTimeout(800);
  await expect(preview).toHaveCount(0);
  // Actually leaving and returning makes the next hover intentional.
  await page.mouse.move(5, 5);
  await help.hover();
  await expect(preview).toBeVisible();
  const box = (await preview.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(600);
  await expect(preview).toBeVisible();
  await page.mouse.move(5, 5, { steps: 5 });
  await expect(preview).toHaveCount(0);
  await expect(build).toBeVisible();
  await help.click();
  await expect(pinned).toBeVisible();
  await expect(preview).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(pinned).toHaveCount(0);
  await expect(build).toBeVisible();
  await page.waitForTimeout(800);
  await expect(preview).toHaveCount(0);
});

test("touch pins manual help and preserves its workspace on dismissal", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, "Tap-to-pin is the touch contract");
  const { build, help } = await openWorkspaceHelp(page);
  await help.tap();
  const pinned = page.getByRole("dialog", { name: "Manual help" });
  await expect(pinned).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Manual preview" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(pinned).toHaveCount(0);
  await expect(build).toBeVisible();
  await expect(help).toBeVisible();
});
