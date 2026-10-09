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
    test.skip(!info.project.name.startsWith("mobile-"));
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
    const header = (await hud.locator(".missionSummaryHeader").boundingBox())!;
    const details = (await hud.locator(".missionDetailsButton").boundingBox())!;
    // The whole touch target stays in its own row, away from the evidence link below.
    expect(details.y).toBeGreaterThanOrEqual(header.y);
    expect(details.y + details.height).toBeLessThanOrEqual(
      header.y + header.height,
    );
    expect((await hud.boundingBox())!.height).toBeLessThanOrEqual(224);
    await expect(
      hud.getByRole("button", { name: "All requirements", exact: true }),
    ).toBeVisible();
  });
}

test("cash-only objectives keep the month-end target visible", async ({
  page,
}, info) => {
  await page.addInitScript(
    (theme) => {
      localStorage.clear();
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem("theme", theme);
    },
    info.project.name.startsWith("mobile-") ? "dark" : "light",
  );
  await page.goto("/?scenario=104");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const goal = page.locator(
    ".missionGoalFull:visible, .missionGoalPhone:visible",
  );
  await expect(goal).toContainText("≥$0");
  await expect(goal).toContainText("month end");
  expect(
    await page
      .locator(".missionSummaryHeadline:visible")
      .evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);
  const timeframe = page.locator(".missionRiskTimeframe:visible");
  await expect(timeframe).toBeVisible();
  const colors = await timeframe.evaluate((element) => ({
    foreground: getComputedStyle(element).color,
    background: getComputedStyle(element.closest("button")!).backgroundColor,
  }));
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const foreground = luminance(colors.foreground);
  const background = luminance(colors.background);
  expect(
    (Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05),
  ).toBeGreaterThanOrEqual(4.5);
  const screenshotDir = process.env.REVIEW_SCREENSHOT_DIR;
  if (
    screenshotDir &&
    ["desktop-chromium", "mobile-390px"].includes(info.project.name)
  ) {
    await expect(page.locator("#chartSupplyDemand")).toBeVisible();
    await expect(
      page.getByText("Starting your mission…", { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: path.join(screenshotDir, `pr-cash-goal-${info.project.name}.png`),
    });
  }
});
