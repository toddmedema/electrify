import { expect, test } from "@playwright/test";
import path from "node:path";
import {
  createDesktopProfile,
  DesktopSession,
  displayState,
  launchDesktop,
  removeDesktopProfile,
} from "./desktop-fixture";
import { openSettingsWithKeyboard, verifyMenuKeyboard } from "./menu-keyboard";

let profile: string;
let desktop: DesktopSession;

test.beforeEach(async () => {
  profile = await createDesktopProfile();
  desktop = await launchDesktop(profile);
  await desktop.page.addInitScript(() => {
    localStorage.setItem("theme", "system");
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem("musicVolume", "0.5");
    localStorage.setItem("soundEffectsVolume", "0.5");
  });
  await desktop.page.reload();
  await expect(
    desktop.page.getByRole("button", { name: "Play", exact: true }),
  ).toBeFocused();
});

test.afterEach(async ({}, testInfo) => {
  if (desktop) {
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo
        .attach("keyboard-failure.png", {
          body: await desktop.page.screenshot(),
          contentType: "image/png",
        })
        .catch(() => undefined);
      await desktop.app
        .evaluate(({ app }) => app.exit(0))
        .catch(() => undefined);
    }
    await desktop.app.close().catch(() => undefined);
  }
  if (profile) await removeDesktopProfile(profile);
});

test("packaged fullscreen menus support the same keyboard journey as web", async () => {
  await verifyMenuKeyboard(desktop.page);
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
});

test("desktop settings keep keyboard selection visible in dark mode", async () => {
  const { page } = desktop;
  await openSettingsWithKeyboard(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const dark = page
    .getByRole("group", { name: "Appearance" })
    .getByRole("button", { name: "Dark", exact: true });
  await expect(dark).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("switch", { name: "Fullscreen", exact: true }),
  ).toBeChecked();
  await page.keyboard.press("ArrowLeft");
  const light = page
    .getByRole("group", { name: "Appearance" })
    .getByRole("button", { name: "Light", exact: true });
  await expect(light).toBeFocused();
  await expect(light).toHaveAttribute("aria-pressed", "false");
  const shots = process.env.REVIEW_SCREENSHOT_DIR;
  if (shots)
    await page.screenshot({
      path: path.join(shots, "settings-selection-desktop.png"),
      animations: "disabled",
    });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
});

test("Escape closes the native resolution popup before leaving settings", async () => {
  const { page } = desktop;
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("switch", { name: "Fullscreen", exact: true }).uncheck();
  await expect
    .poll(async () => (await displayState(desktop.app)).fullscreen)
    .toBe(false);
  const resolution = page.getByRole("combobox", {
    name: "Resolution",
    exact: true,
  });
  await expect(resolution).toBeEnabled();
  await expect(resolution).toHaveAttribute("aria-busy", "false");
  const previous = await resolution.inputValue();
  await resolution.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(resolution).toHaveValue(previous);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  expect(desktop.errors).toEqual([]);
  expect(desktop.externalRequests).toEqual([]);
});
