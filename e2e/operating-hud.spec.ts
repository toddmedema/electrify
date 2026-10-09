import path from "path";
import { expect, test } from "./fixtures";
import { editSavedGame, readSavedGame } from "./save-fixture";
import {
  EMPTY_HISTORY,
  getDateFromMinute,
  MINUTES_PER_MONTH,
} from "../src/helpers/DateTime";

for (const theme of ["light", "dark"]) {
  test(`operating context and objective stay visible in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=107");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const hud = page.locator("#appbar:visible");
    await expect(hud.locator(".gameOperatingContext")).toContainText(
      "Deep Freeze",
    );
    await expect(hud.locator(".gameOperatingContext")).toContainText(
      "Austin, TX",
    );
    await expect(hud.locator(".missionSummaryHeadline")).toContainText(
      "served",
    );
    await expect(hud.locator(".gridHealthTime")).toHaveText("Now");
    await expect(
      hud.getByRole("button", { name: "pause", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      hud.getByRole("button", { name: "All requirements", exact: true }),
    ).toBeVisible();
    await expect(hud.locator(".missionRiskButton")).toContainText(
      "Upcoming: The deep freeze",
    );
    await expect(hud.locator(".gridHealth")).not.toHaveClass(
      /gridHealth-blackout/,
    );
    await expect(page.locator("#chartSupplyDemand")).toBeInViewport();
    await page.waitForTimeout(400);
    const clips = await hud.evaluate((element) =>
      Array.from(
        element.querySelectorAll(
          ".gameOperatingContext, .gridHealth, .missionSummary, #speedChangeButtons",
        ),
      ).some((node) => {
        const box = node.getBoundingClientRect();
        return box.left < 0 || box.right > innerWidth + 1;
      }),
    );
    expect(clips).toBe(false);
    const screenshotDir = process.env.REVIEW_SCREENSHOT_DIR;
    if (
      screenshotDir &&
      (info.project.name === "desktop-chromium" ||
        (theme === "dark" && info.project.name === "mobile-390px"))
    ) {
      await page.screenshot({
        path: path.join(
          screenshotDir,
          `pr-hud-${info.project.name}-${theme}.png`,
        ),
      });
    }
    await hud.locator(".missionRiskButton").click();
    await expect(page.locator(".insights:visible")).toBeVisible();
  });
}

for (const state of [
  "pending",
  "progressed",
  "failed",
  "unknown",
  "retention",
] as const) {
  test(`phone goal preserves target and ${state} evidence without growing`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "mobile-390px");
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("hud-state-fixture")) {
        localStorage.clear();
        sessionStorage.setItem("hud-state-fixture", "true");
      }
      localStorage.setItem("theme", "dark");
      localStorage.setItem("audioEnabled", "false");
    });
    await page.goto(`/?scenario=${state === "retention" ? 100 : 111}`);
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    if (state !== "pending" && state !== "retention") {
      await expect
        .poll(async () => Boolean(await readSavedGame(page)))
        .toBe(true);
      await editSavedGame(page, (save) => {
        const minute = 37 * MINUTES_PER_MONTH;
        const offset = minute - save.game.date.minute;
        save.game.date = getDateFromMinute(minute, save.game.startingYear);
        save.game.timeline.forEach((tick) => {
          tick.minute += offset;
          tick.cash = 1e12;
        });
        save.game.monthlyHistory =
          state === "unknown"
            ? []
            : [
                {
                  ...EMPTY_HISTORY,
                  year: 2025,
                  month: 1,
                  demandWh: 100,
                  supplyWh: state === "failed" ? 99 : 100,
                },
              ];
      });
      await page.reload();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      // Advancing the saved date also makes the authored preparedness choice due.
      await page
        .getByRole("button", { name: "Keep cash", exact: true })
        .click();
    }
    const hud = page.locator("#appbar:visible");
    const goal = hud.locator(".missionGoalPhone");
    await expect(goal).toBeVisible();
    if (state === "retention") {
      await expect(goal).toHaveText(/Customers [\d,]+ \/ ≥[\d,]+/);
    } else {
      await expect(goal).toContainText("≥99.5%");
      await expect(goal).toContainText(
        state === "progressed"
          ? "100% /"
          : state === "failed"
            ? "99% /"
            : state,
      );
    }
    expect(
      await hud
        .locator(".missionSummaryHeadline")
        .evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      (await hud.locator(".missionSummaryHeader").boundingBox())!.height,
    ).toBe(32);
    expect((await hud.boundingBox())!.height).toBeLessThanOrEqual(212);
    await expect(
      hud.getByRole("button", { name: "All requirements", exact: true }),
    ).toBeVisible();
  });
}
