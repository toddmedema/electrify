import { expect, Page } from "@playwright/test";

/** The caller installs the clock before loading; keep return focus pending for a body key. */
export async function exitSettingsWithBodyArrow(page: Page): Promise<void> {
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.keyboard.press("Escape");
  // Hover can focus a control revealed beneath the pointer. Wait for the menu,
  // not a particular selection, while the exit and return-focus timers are paused.
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main[inert] #gameCard")).toHaveCount(1);
  // Native state can finish loading and refocus the initial menu after a bare blur.
  // Hold this fixture's background precondition only until the real arrow is dispatched.
  await page.evaluate(() => {
    const blur = () => (document.activeElement as HTMLElement)?.blur();
    document.addEventListener("focusin", blur, true);
    document.addEventListener(
      "keydown",
      () => document.removeEventListener("focusin", blur, true),
      { capture: true, once: true },
    );
    blur();
  });
  await expect(page.locator("body")).toBeFocused();
  await page.keyboard.press("ArrowUp");
}

export async function openSettingsWithKeyboard(page: Page): Promise<void> {
  const start = page.getByRole("button", {
    name: "Play",
    exact: true,
  });
  await expect(start).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const friends = page.getByRole("button", {
    name: "Play with friends",
    exact: true,
  });
  if (await friends.isVisible()) {
    await expect(friends).toBeFocused();
    await page.keyboard.press("ArrowDown");
  }
  const achievements = page.getByRole("button", {
    name: "Achievements",
    exact: true,
  });
  if (await achievements.isVisible()) {
    await expect(achievements).toBeFocused();
    await page.keyboard.press("ArrowDown");
  }
  await expect(
    page.getByRole("button", { name: "Manual", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const mods = page.getByRole("button", { name: "Mods", exact: true });
  if (await mods.isVisible()) {
    await expect(mods).toBeFocused();
    await page.keyboard.press("ArrowDown");
  }
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await expect(settings).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
}

/** The same keyboard-only journey runs in Chromium and the packaged game. */
export async function verifyMenuKeyboard(page: Page): Promise<void> {
  await openSettingsWithKeyboard(page);
  const appearance = page.getByRole("group", {
    name: "Appearance",
    exact: true,
  });
  const system = appearance.getByRole("button", {
    name: "System",
    exact: true,
  });
  const light = appearance.getByRole("button", { name: "Light", exact: true });
  await expect(system).toBeFocused();
  await expect(system).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(light).toBeFocused();
  // Moving the cursor doesn't silently change a preference; Enter confirms it.
  await expect(system).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(light).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("ArrowDown");
  const sizes = page.getByRole("group", { name: "Text size", exact: true });
  const standard = sizes.getByRole("button", { name: "Standard", exact: true });
  const large = sizes.getByRole("button", { name: "Large", exact: true });
  await expect(standard).toBeFocused();
  await expect(standard).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(large).toBeFocused();
  await expect(standard).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(large).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveCSS("font-size", "18px");
  await page.keyboard.press("ArrowLeft");
  await expect(standard).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(standard).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveCSS("font-size", "16px");
  await page.keyboard.press("ArrowDown");
  const sound = page.getByRole("switch", { name: "Sound", exact: true });
  await expect(sound).toBeFocused();
  await expect(sound).not.toBeChecked();
  await page.keyboard.press("Enter");
  await expect(sound).toBeChecked();
  await page.keyboard.press("ArrowDown");
  const music = page.getByRole("slider", { name: "Music volume", exact: true });
  await expect(music).toBeFocused();
  await expect(music).toHaveAttribute("aria-valuenow", "50");
  await page.keyboard.press("ArrowRight");
  await expect(music).toHaveAttribute("aria-valuenow", "51");
  await expect(music).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("slider", { name: "Effects volume", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  const start = page.getByRole("button", {
    name: "Play",
    exact: true,
  });
  await expect(start).toBeVisible();
  await expect(start).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const friends = page.getByRole("button", {
    name: "Play with friends",
    exact: true,
  });
  if (await friends.isVisible()) {
    await expect(friends).toBeFocused();
    await page.keyboard.press("ArrowDown");
  }
  const achievements = page.getByRole("button", {
    name: "Achievements",
    exact: true,
  });
  if (await achievements.isVisible()) {
    await expect(achievements).toBeFocused();
    await page.keyboard.press("ArrowDown");
  }
  await expect(
    page.getByRole("button", { name: "Manual", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowUp");
  if (await achievements.isVisible()) {
    await expect(achievements).toBeFocused();
    await page.keyboard.press("ArrowUp");
  }
  if (await friends.isVisible()) {
    await expect(friends).toBeFocused();
    await page.keyboard.press("ArrowUp");
  }
  await expect(start).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".facilities:visible")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Step 1 of 4", exact: true }),
  ).toBeVisible();
}
