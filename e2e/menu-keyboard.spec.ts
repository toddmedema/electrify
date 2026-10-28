import path from "node:path";
import { expect, test } from "./fixtures";
import { exitSettingsWithBodyArrow, verifyMenuKeyboard } from "./menu-keyboard";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("menu-keyboard-seeded")) return;
    sessionStorage.setItem("menu-keyboard-seeded", "true");
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

for (const pointerOverSettings of [false, true]) {
  test(`a background arrow during Settings exit preserves volume and restores focus${pointerOverSettings ? " with the pointer over Settings" : ""}`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.clock.install();
    await page.reload();
    const settings = page.getByRole("button", {
      name: "Settings",
      exact: true,
    });
    const menuBounds = await settings.boundingBox();
    await settings.click();
    await page.getByRole("switch", { name: "Sound", exact: true }).check();
    const effects = page.getByRole("slider", {
      name: "Effects volume",
      exact: true,
    });
    await effects.focus();
    await effects.press("Home");
    await expect(effects).toHaveAttribute("aria-valuenow", "0");
    if (pointerOverSettings) {
      await page.mouse.move(
        menuBounds!.x + menuBounds!.width / 2,
        menuBounds!.y + menuBounds!.height / 2,
      );
    }
    await exitSettingsWithBodyArrow(page);
    await page.clock.runFor(1000);
    await expect(settings).toBeFocused();
    expect(
      await page.evaluate(() => localStorage.getItem("soundEffectsVolume")),
    ).toBe("0");
    await page.clock.resume();
    await page.reload();
    await settings.click();
    await expect(effects).toHaveAttribute("aria-valuenow", "0");
  });
}

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

test("global shortcuts keep shifted fleet actions and manual typing separate", async ({
  page,
}) => {
  await page.goto("/?scenario=111");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".facilities:visible")).toBeVisible();
  await page.keyboard.press("0");
  const paused = page
    .getByRole("group", { name: "game speed", exact: true })
    .getByRole("button", { name: "pause", exact: true });
  await expect(paused).toHaveAttribute("aria-pressed", "true");
  const first = page.locator(".facilityRow").first();
  const name = await first.getAttribute("data-facility");
  expect(name).toBeTruthy();
  await page.keyboard.press("Shift+1");
  await expect(page.getByText(`Paused ${name}`, { exact: true })).toBeVisible();
  await expect(paused).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Shift+1");
  await expect(
    page.getByText(`Resumed ${name}`, { exact: true }),
  ).toBeVisible();

  await page.keyboard.press("Shift+/");
  const search = page.getByRole("textbox", {
    name: "Search the manual",
    exact: true,
  });
  await expect(search).toBeVisible();
  await search.pressSequentially("q?123");
  await expect(search).toHaveValue("q?123");
  await search.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(page.locator(".facilities:visible")).toBeVisible();
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

test("touch hides button focus rings while inputs and keyboard navigation retain focus indicators", async ({
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
  await expect(search).toHaveCSS("outline-style", "none");
  await expect(search.locator("..").locator("fieldset")).toHaveCSS(
    "border-width",
    "2px",
  );
});
