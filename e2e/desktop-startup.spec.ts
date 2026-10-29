import { expect, test } from "@playwright/test";
import {
  createDesktopProfile,
  launchDesktop,
  removeDesktopProfile,
} from "./desktop-fixture";

for (const { width, height, colorScheme, reducedMotion, returning } of [
  {
    width: 1440,
    height: 900,
    colorScheme: "dark",
    reducedMotion: "no-preference",
    returning: false,
  },
  {
    width: 390,
    height: 844,
    colorScheme: "light",
    reducedMotion: "no-preference",
    returning: true,
  },
  {
    width: 360,
    height: 640,
    colorScheme: "dark",
    reducedMotion: "reduce",
    returning: false,
  },
] as const) {
  test(`native ${returning ? "returning" : "first"} entrance hands off at ${width}px in ${colorScheme}`, async () => {
    const profile = await createDesktopProfile();
    const { app, page, errors } = await launchDesktop(profile);
    try {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme, reducedMotion });
      await page.evaluate(
        ({ theme, returning }) => {
          localStorage.setItem("theme", theme);
          if (returning)
            localStorage.setItem("electrify-startup-complete", "true");
          else localStorage.removeItem("electrify-startup-complete");
        },
        { theme: colorScheme, returning },
      );
      await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("desktop:read-saves");
        ipcMain.handle(
          "desktop:read-saves",
          () =>
            new Promise((resolve) => {
              ipcMain.once("test:release-startup", () =>
                resolve({ local: null, cloud: null, cloudState: "disabled" }),
              );
            }),
        );
      });
      await page.reload();
      const entrance = page.locator("#appStartup");
      await expect(entrance.getByRole("status")).toHaveText(
        "Reticulating splines...",
      );
      await expect(entrance.getByAltText("Electrify")).toBeVisible();
      await expect(page.locator("#menuCard")).toHaveCount(0);
      const bounds = await entrance.getByAltText("Electrify").boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      const animations = await entrance
        .locator(".homeLogo")
        .evaluate((logo) => {
          const animations = logo.getAnimations({ subtree: true });
          // Hold all visual animation: releasing initialization must still make the menu usable.
          animations.forEach((animation) => animation.pause());
          return animations.length;
        });
      expect(animations > 0).toBe(reducedMotion !== "reduce");
      await app.evaluate(({ ipcMain }) => {
        ipcMain.emit("test:release-startup");
      });
      await expect(entrance).toHaveCount(0);
      const start = page.getByRole("button", {
        name: "Play",
        exact: true,
      });
      await expect(start).toBeEnabled();
      await start.click();
      await expect(
        page.getByRole("button", { name: "Settings", exact: true }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
      await removeDesktopProfile(profile);
    }
  });
}

test("startup failure retains branding and keyboard recovery", async () => {
  const profile = await createDesktopProfile();
  const { app, page } = await launchDesktop(profile);
  try {
    await page.setViewportSize({ width: 360, height: 640 });
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("desktop:read-saves");
      ipcMain.handle("desktop:read-saves", () => {
        throw new Error("Unreadable test backup");
      });
    });
    await page.reload();
    await expect(page.getByRole("alert")).toContainText(
      "Saved games couldn't be restored",
    );
    await expect(page.getByAltText("Electrify")).toBeVisible();
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeFocused();
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      (await page
        .getByRole("button", { name: "Quit", exact: true })
        .boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("desktop:read-saves");
      ipcMain.handle("desktop:read-saves", () => ({
        local: null,
        cloud: null,
        cloudState: "disabled",
      }));
    });
    await retry.press("Enter");
    await expect(page.locator("#appStartup")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeEnabled();
  } finally {
    await app.close();
    await removeDesktopProfile(profile);
  }
});
