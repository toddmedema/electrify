import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import manifest from "../src/data/RunCompatibility.json";
import type { InstalledMod } from "../src/mods/Types";

for (const layout of [
  { width: 1280, height: 900, theme: "light" },
  { width: 390, height: 844, theme: "dark" },
] as const) {
  test(`public mod management and offline launch at ${layout.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(layout);
    await page.emulateMedia({
      colorScheme: layout.theme,
      reducedMotion: "reduce",
    });
    await page.addInitScript(
      ({ rules }) => {
        localStorage.setItem("audioEnabled", "false");
        localStorage.setItem("theme", "system");
        const noop = () => () => {};
        const display = {
          fullscreen: false,
          width: 1280,
          height: 900,
          resolutions: [{ width: 1280, height: 900 }],
        };
        let entries: InstalledMod[] = [
          {
            key: "local:community-grid",
            source: "local",
            enabled: true,
            pack: {
              schemaVersion: 1,
              id: "community-grid",
              title: "Community Grid",
              creator: "Community author",
              version: "1.0.0",
              rules,
              seed: 42,
              baseScenarioId: 999,
              facilities: { Solar: { buildCost: 0.8 } },
              programs: { efficiency: 0.8 },
            },
          },
        ];
        window.electrifyDesktop = {
          apiVersion: 1,
          getState: async () => ({
            display,
            modsAvailable: true,
            steam: { available: false, online: false, cloudEnabled: false },
          }),
          setDisplay: async () => display,
          setInputContext: async () => ({
            connected: true,
            actions: [],
            glyphs: {},
          }),
          onInput: (callback) => {
            const listener = (event: Event) =>
              callback((event as CustomEvent).detail);
            window.addEventListener("mockModController", listener);
            return () =>
              window.removeEventListener("mockModController", listener);
          },
          onStateChanged: noop,
          onGameFocusChanged: noop,
          onBeforeQuit: noop,
          readyToQuit: () => {},
          quit: async () => {},
          readSaveLibrary: async () => ({
            local: null,
            cloud: null,
            cloudState: "disabled",
          }),
          writeSaveLibrary: async () => ({ cloudState: "disabled" }),
          getLeaderboard: async () => [],
          submitScore: async () => {
            throw new Error("Modded runs must not submit scores");
          },
          openFriends: async () => {},
          mods: async (input) => {
            if (
              input.kind === "refresh" ||
              input.kind === "subscribe" ||
              input.kind === "publish"
            )
              throw new Error(
                "Connect to Steam to use Workshop. Local mods remain available.",
              );
            if (input.kind === "enable")
              entries = entries.map((e) =>
                e.key === input.key ? { ...e, enabled: input.enabled } : e,
              );
            if (input.kind === "remove")
              entries = entries.filter((e) => e.key !== input.key);
            return { entries };
          },
        };
      },
      { rules: manifest.compatibilityId },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const mods = page.getByRole("region", { name: "Mods and Workshop" });
    await expect(
      mods.getByText("Community Grid", { exact: true }),
    ).toBeVisible();
    const play = mods.getByRole("button", { name: "Play Community Grid" });
    const controller = async (action: "down" | "right") => {
      await page.evaluate(
        (action) =>
          window.dispatchEvent(
            new CustomEvent("mockModController", {
              detail: { connected: true, actions: [action], glyphs: {} },
            }),
          ),
        action,
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    };
    const importButton = mods.getByRole("button", {
      name: "Import mod",
      exact: true,
    });
    for (
      let i = 0;
      i < 30 &&
      !(await importButton.evaluate((e) => e === document.activeElement));
      i++
    )
      await controller("down");
    await expect(importButton).toBeFocused();
    await controller("right");
    await expect(
      mods.getByRole("button", { name: "Save authoring template" }),
    ).toBeFocused();
    await controller("down");
    await expect(
      mods.getByRole("textbox", { name: "Workshop item ID" }),
    ).toBeFocused();
    for (
      let i = 0;
      i < 8 && !(await play.evaluate((e) => e === document.activeElement));
      i++
    )
      await controller("down");
    await expect(play).toBeFocused();
    await expect(play).toBeEnabled();
    await mods.getByRole("switch", { name: "Enabled" }).click();
    await expect(play).toBeDisabled();
    await mods.getByRole("switch", { name: "Enabled" }).click();
    await mods.getByRole("button", { name: "Refresh downloads" }).click();
    await expect(mods.getByRole("alert")).toContainText("Connect to Steam");
    await mods.getByRole("button", { name: "Publish to Workshop" }).click();
    await expect(page.getByRole("dialog")).toContainText("publicly");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      mods.getByRole("button", { name: "Publish to Workshop" }),
    ).toBeFocused();
    // Clear the intentional offline error before capturing the finished interface.
    await mods.getByRole("switch", { name: "Enabled" }).click();
    await mods.getByRole("switch", { name: "Enabled" }).click();
    await mods.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.REVIEW_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `mods-${layout.width}-${layout.theme}.png`,
        ),
        animations: "disabled",
      });
    }
    await play.click();
    await expect(
      page.getByRole("button", { name: "Build", exact: true }),
    ).toBeVisible({ timeout: 60000 });
  });
}
