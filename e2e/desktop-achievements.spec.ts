import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createDesktopProfile,
  launchDesktop,
  removeDesktopProfile,
} from "./desktop-fixture";
import type { DesktopBridge } from "../src/Desktop";

test("a real tutorial completion journals First Spark offline and survives relaunch without duplicates", async () => {
  const profile = await createDesktopProfile();
  let desktop = await launchDesktop(profile);
  const journal = path.join(profile, "players", "offline", "achievements.json");
  const read = async (): Promise<{
    earned: string[];
    confirmed: string[];
    tutorials: number[];
  }> => {
    try {
      return JSON.parse(await fs.readFile(journal, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { earned: [], confirmed: [], tutorials: [] };
      throw error;
    }
  };
  try {
    const page = desktop.page;
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page
      .getByRole("button", { name: "Inspect Coal", exact: true })
      .click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Tap 1× to start time")).toBeVisible();
    expect((await read()).earned).toEqual([]);
    await page
      .getByRole("button", { name: "normal speed", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: /Mission complete!/ }),
    ).toBeVisible({ timeout: 60000 });
    await expect
      .poll(async () => (await read()).earned)
      .toEqual(["FIRST_SPARK"]);
    expect((await read()).tutorials).toEqual([0]);
    expect((await read()).confirmed).toEqual([]);
    expect(desktop.errors).toEqual([]);
    expect(desktop.externalRequests).toEqual([]);
    await desktop.app.close();
    desktop = await launchDesktop(profile);
    expect((await read()).earned).toEqual(["FIRST_SPARK"]);
    await desktop.page.evaluate(async () => {
      const bridge = (window as unknown as { electrifyDesktop: DesktopBridge })
        .electrifyDesktop;
      await bridge.submitAchievements!({
        earned: ["FIRST_SPARK"],
        completion: { scenarioId: 0, difficulty: "Intern" },
      });
    });
    expect((await read()).earned).toEqual(["FIRST_SPARK"]);
    expect((await read()).tutorials).toEqual([0]);
    const rejected = await desktop.page.evaluate(async () => {
      try {
        await (window as unknown as { electrifyDesktop: DesktopBridge })
          .electrifyDesktop.submitAchievements!({ earned: ["INVALID"] });
        return false;
      } catch {
        return true;
      }
    });
    expect(rejected).toBe(true);
  } finally {
    await desktop.app.close().catch(() => undefined);
    await removeDesktopProfile(profile);
  }
});
