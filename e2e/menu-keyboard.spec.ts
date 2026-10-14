import path from "node:path";
import { expect, test } from "./fixtures";
import { verifyMenuKeyboard } from "./menu-keyboard";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("theme", "system");
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem("musicVolume", "0.5");
    localStorage.setItem("soundEffectsVolume", "0.5");
  });
});

test("main menu and settings work entirely with arrows, Enter and Escape", async ({
  page,
}) => {
  await page.goto("/");
  await verifyMenuKeyboard(page);
});

test("selection is visible in both themes without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start playing", exact: true }),
  ).toBeFocused();
  const shots = process.env.REVIEW_SCREENSHOT_DIR;
  if (shots && testInfo.project.name === "desktop-chromium")
    await page.screenshot({
      path: path.join(shots, "menu-selection-light.png"),
      animations: "disabled",
    });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const appearance = page.getByRole("group", { name: "Appearance" });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const dark = appearance.getByRole("button", { name: "Dark", exact: true });
  await expect(dark).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (shots && testInfo.project.name === "mobile-390px")
    await page.screenshot({
      path: path.join(shots, "settings-selection-phone.png"),
      animations: "disabled",
    });
});
