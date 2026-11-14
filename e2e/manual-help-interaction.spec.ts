import { expect, Page, test } from "./fixtures";
import { openBuild } from "./layout";
import { selectManualText } from "./manual-selection";

async function openWorkspaceHelp(
  page: Page,
  theme: "light" | "dark" = "light",
) {
  await page.addInitScript((mode) => {
    localStorage.clear();
    localStorage.setItem("theme", mode);
    localStorage.setItem("audioEnabled", "false");
  }, theme);
  await page.goto("/?scenario=111");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const build = await openBuild(page);
  const option = build.locator(".buildOption").first();
  await option.getByRole("button", { name: /^Show .* details$/ }).click();
  const help = option.getByRole("button", { name: /^What is / }).first();
  await expect(help).toBeVisible();
  return { build, help };
}

for (const theme of ["light", "dark"] as const) {
  test(`mouse help cues stay quiet until activated in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, "Mouse hover affordance");
    const { build, help } = await openWorkspaceHelp(page, theme);
    const pinned = page.getByRole("dialog", { name: "Manual help" });
    const preview = page.getByRole("dialog", { name: "Manual preview" });
    const row = help.locator(
      "xpath=ancestor::*[contains(@class, 'manual-help-region')][1]",
    );
    await expect(help).toHaveCSS("cursor", "help");
    await expect(row).toHaveCSS("cursor", "help");
    await expect(row).toHaveCSS("background-image", "none");
    await help.hover();
    await expect(row).not.toHaveCSS("background-image", "none");
    await page.waitForTimeout(600);
    await expect(preview).toHaveCount(0);
    await expect(pinned).toHaveCount(0);
    await help.focus();
    await expect(preview).toHaveCount(0);
    await help.press("Enter");
    await expect(pinned).toBeVisible();
    await selectManualText(page, pinned.locator("p").first());
    await selectManualText(page, pinned.getByRole("heading").first());
    await page.keyboard.press("Escape");
    await expect(pinned).toHaveCount(0);
    await expect(help).toBeFocused();
    await expect(build).toBeVisible();
    await help.hover();
    await page.waitForTimeout(600);
    await expect(preview).toHaveCount(0);
    await expect(pinned).toHaveCount(0);
    await help.press("Space");
    await expect(pinned).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pinned).toHaveCount(0);

    // Only the desktop status opens a manual entry; the compact phone icon has a readout tooltip.
    const status = page.getByRole("button", {
      name: /Open the Reserve manual entry/,
    });
    const color = await status.evaluate(
      (element) => getComputedStyle(element).color,
    );
    await expect(status).toHaveCSS("cursor", "help");
    await status.hover();
    await expect(status).not.toHaveCSS("background-image", "none");
    await expect(status).toHaveCSS("color", color);
    await page.waitForTimeout(600);
    await expect(pinned).toHaveCount(0);
    await status.click();
    await expect(
      pinned.getByRole("heading", { name: "Reserve capacity", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pinned).toHaveCount(0);
    await expect(status).toBeFocused();
  });
}

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
