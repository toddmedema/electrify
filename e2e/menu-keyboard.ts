import { expect, Page } from "@playwright/test";

/** The same keyboard-only journey runs in Chromium and the packaged game. */
export async function verifyMenuKeyboard(page: Page): Promise<void> {
  const start = page.getByRole("button", {
    name: "Start playing",
    exact: true,
  });
  await expect(start).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: "Manual", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await expect(settings).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();

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
  await expect(start).toBeVisible();
  await expect(settings).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await expect(
    page.getByRole("button", { name: "Manual", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(start).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".facilities:visible")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Step 1 of 4", exact: true }),
  ).toBeVisible();
}
