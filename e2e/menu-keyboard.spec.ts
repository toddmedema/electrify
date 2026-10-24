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

test("Space activates Play", async ({ page }) => {
  await page.goto("/");
  const start = page.getByRole("button", {
    name: "Play",
    exact: true,
  });
  await start.focus();
  await expect(start).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator(".facilities:visible")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Step 1 of 4", exact: true }),
  ).toBeVisible();
});

test("Space opens Settings", async ({ page }) => {
  await page.goto("/");
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.focus();
  await expect(settings).toBeFocused();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
});

test("Space toggles Sound", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const sound = page.getByRole("switch", { name: "Sound", exact: true });
  await sound.focus();
  await expect(sound).toBeFocused();
  await expect(sound).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(sound).toBeChecked();
  await page.keyboard.press("Space");
  await expect(sound).not.toBeChecked();
});

test("a background arrow during Settings exit preserves volume and restores focus", async ({
  page,
}) => {
  await page.goto("/");
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await page.getByRole("switch", { name: "Sound", exact: true }).check();
  const effects = page.getByRole("slider", {
    name: "Effects volume",
    exact: true,
  });
  await effects.focus();
  await effects.press("Home");
  await expect(effects).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("Escape");
  // Reproduce the native audit: the early arrow lands on body, not a menu control.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await expect(page.locator("body")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(settings).toBeFocused();
  expect(
    await page.evaluate(() => localStorage.getItem("soundEffectsVolume")),
  ).toBe("0");
});

test("Space activates game navigation while body Space pauses", async ({
  page,
}) => {
  await page.goto("/?scenario=106");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const speed = page.getByRole("group", { name: "game speed", exact: true });
  await expect(speed).toBeVisible();
  await page.keyboard.press("1");
  const slow = speed.getByRole("button", { name: "slow speed", exact: true });
  const paused = speed.getByRole("button", { name: "pause", exact: true });
  await expect(slow).toHaveAttribute("aria-pressed", "true");
  const events = page.getByRole("button", { name: "Events", exact: true });
  await events.focus();
  await expect(events).toBeFocused();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("region", { name: "Events", exact: true }),
  ).toBeVisible();
  await expect(slow).toHaveAttribute("aria-pressed", "true");
  await expect(paused).toHaveAttribute("aria-pressed", "false");
  // Blur the tool heading onto the game surface: this Space still owns the global pause.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await expect(page.locator("body")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(paused).toHaveAttribute("aria-pressed", "true");
});

test("selection is visible in both themes without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
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

test("touch hides button focus rings while text inputs and keyboard navigation keep theirs", async ({
  page,
}, info) => {
  test.skip(!info.project.use.hasTouch, "Requires actual touch input");
  await page.goto("/");
  const start = page.getByRole("button", {
    name: "Play",
    exact: true,
  });
  await expect(start).toBeFocused();
  await expect(start).toHaveCSS("outline-style", "none");
  await page.getByRole("button", { name: "Settings", exact: true }).tap();
  const system = page.getByRole("button", { name: "System", exact: true });
  await expect(system).toBeFocused();
  await expect(system).toHaveCSS("outline-style", "none");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveCSS("outline-style", "solid");
  await expect(page.locator(":focus")).toHaveCSS("outline-width", "2px");
  const focusedButton = page.locator("button:focus");
  await expect(focusedButton).toHaveCount(1);
  await focusedButton.tap();
  await expect(focusedButton).toHaveCSS("outline-style", "none");
  await page.goto("/?dataCenters=1");
  const search = page.getByRole("combobox", {
    name: "Select a city",
    exact: true,
  });
  await search.tap();
  await expect(search).toBeFocused();
  await expect(search).toHaveCSS("outline-style", "solid");
  await expect(search).toHaveCSS("outline-width", "2px");
});
