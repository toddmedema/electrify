import path from "path";
import "../src/Store";
import { test, expect } from "./fixtures";
import { openBuild } from "./layout";
import { expectDialogToFit } from "./dialog-layout";
import { editSavedGame, readSavedGame } from "./save-fixture";
import { TICKS_PER_MONTH, DIFFICULTY_LABELS } from "../src/Constants";
import { LEGACY_SCENARIOS } from "../src/data/LegacyCampaign";
import { resolveStoryAtDate } from "../src/data/WorldEvents";
import { parseSave, serializeSave } from "../src/SaveGame";
import { encodeSave } from "../src/SaveEncoding";
import { generateNewTimeline, tickState } from "../src/reducers/Game";
import { loadSimData } from "../src/testing/SimData";
import {
  getDateFromMinute,
  MINUTES_PER_MONTH,
  summarizeTimeline,
} from "../src/helpers/DateTime";
import {
  initializeGameObjectiveProgress,
  recordGameObjectiveMonth,
} from "../src/helpers/ObjectiveRules";
import { scenarioRules } from "../src/helpers/ScenarioRules";
import { buildStorySnapshot } from "../src/helpers/Story";

const REVIEW_PROJECTS = ["desktop-chromium", "mobile-390px", "mobile-360px"];

for (const theme of ["light", "dark"] as const) {
  test(`campaign entry, historical builds, and saved CEO handover work in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(!REVIEW_PROJECTS.includes(info.project.name));
    await page.addInitScript((value) => {
      localStorage.clear();
      localStorage.setItem("theme", value);
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [{ scenarioId: 0, timesPlayed: 1, date: "2026-11-02" }],
        }),
      );
    }, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Choose a game", exact: true }),
    ).toBeVisible();
    const headings = await page
      .getByRole("heading", { level: 2 })
      .allTextContents();
    expect(headings.indexOf("Campaign")).toBeGreaterThan(
      headings.indexOf("Learn the basics"),
    );
    expect(headings.indexOf("Campaign")).toBeLessThan(
      headings.indexOf("Challenges"),
    );
    await expect(page.locator('[class*="-exit-active"]')).toHaveCount(0);
    const catalogColumn = await page
      .locator(".missionList .groupedList")
      .first()
      .boundingBox();
    expect(catalogColumn).not.toBeNull();
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      theme === "light" &&
      info.project.name === "desktop-chromium"
    ) {
      await expect(page.locator('[class*="-exit-active"]')).toHaveCount(0);
      await page.screenshot({
        animations: "disabled",
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          "legacy-campaign-entry-desktop.png",
        ),
      });
    }
    await page.getByRole("button", { name: "View legacy campaign" }).click();
    await expect(page).toHaveURL(/campaign=legacy/);
    await expect(
      page.getByRole("heading", { name: "Legacy campaign", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Campaign generations" })
        .getByRole("listitem"),
    ).toHaveCount(9);
    await expect(
      page.getByText("First Light (1882–1901)", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("A Different Kind of Growth (2042–2061)", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Your first grid:/)).toHaveCount(0);
    await expect(page.getByText(/The game pauses/)).toHaveCount(0);
    await expect(page.getByText(/Northern California ·/)).toHaveCount(0);
    await expect(
      page.getByText("Inspired by Northern California history.", {
        exact: false,
      }),
    ).toBeVisible();
    const difficulty = page.getByRole("group", {
      name: "Difficulty",
      exact: true,
    });
    await difficulty
      .getByRole("button", { name: DIFFICULTY_LABELS.Manager, exact: true })
      .click();
    await expect(
      difficulty.getByRole("button", {
        name: DIFFICULTY_LABELS.Manager,
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[class*="-exit-active"]')).toHaveCount(0);
    const content = await page.locator(".campaignSetupContent").boundingBox();
    const header = await page
      .locator(".campaignSetup .screenHeaderBar")
      .boundingBox();
    expect(content).not.toBeNull();
    expect(header).not.toBeNull();
    expect(Math.abs(content!.x - catalogColumn!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(content!.width - catalogColumn!.width)).toBeLessThanOrEqual(
      1,
    );
    expect(content!.x).toBeGreaterThanOrEqual(header!.x);
    expect(content!.x + content!.width).toBeLessThanOrEqual(
      header!.x + header!.width,
    );
    expect(
      await page
        .locator(".screenPage:visible")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await expect(page.locator('[class*="-exit-active"]')).toHaveCount(0);
      await page.screenshot({
        animations: "disabled",
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `legacy-campaign-${theme}-${info.project.name}.png`,
        ),
      });
    }
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Choose a game" }),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/campaign=legacy/);
    await page.getByRole("button", { name: "View legacy campaign" }).click();
    await page
      .getByRole("button", { name: "Start campaign", exact: true })
      .click();
    await expect(page.locator(".facilities:visible")).toBeVisible();
    await page
      .getByRole("button", { name: "pause", exact: true })
      .first()
      .click();
    const build = await openBuild(page);
    const size = build.getByRole("slider");
    await expect(size).toHaveAttribute("min", "-14");
    await size.press("Home");
    await expect(size).toHaveValue("-14");
    await build
      .getByRole("button", { name: "Review purchase of Coal" })
      .click();
    await page.getByRole("button", { name: "Take loan", exact: true }).click();
    const opened = await readSavedGame(page);
    expect(opened?.scenarioId).toBe(117);
    expect(opened?.difficulty).toBe("Manager");
    expect(opened?.campaign?.generationIndex).toBe(0);
    expect(
      opened?.facilities.some(
        (facility) => facility.peakW === 50000 && facility.loanAmountLeft > 0,
      ),
    ).toBe(true);

    // Seed completed-month evidence through its owner, then run the real final month up to
    // its last tick. This fixture tests the handover path, not twenty years of balance.
    await editSavedGame(page, (save) => {
      const game = save.game;
      loadSimData(game.location);
      const row = summarizeTimeline(game.timeline, game.startingYear);
      game.monthlyHistory = [];
      game.date = getDateFromMinute(0, game.startingYear);
      game.worldEvents = { active: [], occurrences: [], checkedKeys: [] };
      initializeGameObjectiveProgress(game);
      for (let month = 0; month < 239; month++) {
        game.date = getDateFromMinute(
          (month + 1) * MINUTES_PER_MONTH,
          game.startingYear,
        );
        const closed = {
          ...row,
          year: game.startingYear + Math.floor(month / 12),
          month: (month % 12) + 1,
          customers: 100,
          cash: 100000,
        };
        game.monthlyHistory.unshift(closed);
        recordGameObjectiveMonth(game, closed);
        const resolved = resolveStoryAtDate({
          rules: scenarioRules(LEGACY_SCENARIOS[0], game),
          scenarioId: game.scenarioId,
          difficulty: game.difficulty,
          seed: game.seed,
          date: game.date,
          location: game.location,
          snapshot: buildStorySnapshot(
            game.monthlyHistory,
            game.facilities,
            game.date.minute,
          ),
          occurrences: game.worldEvents.occurrences,
        });
        game.worldEvents.occurrences.push(...resolved.occurrences);
        game.worldEvents.active = resolved.active;
      }
      game.timeline = generateNewTimeline(game, 100000, 100);
      for (let tick = 0; tick < TICKS_PER_MONTH - 1; tick++) tickState(game);
      game.speed = "PAUSED";
      Object.assign(save, serializeSave(game));
      expect(game.campaign?.pendingHandover).toBe(false);
      expect(
        parseSave(JSON.parse(JSON.stringify(encodeSave(save)))),
      ).not.toBeNull();
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByRole("button", { name: "normal speed", exact: true })
      .first()
      .click();
    const handover = page.getByRole("dialog", {
      name: "Term 1 complete",
    });
    await expect(handover).toBeVisible();
    await expect(handover.locator("..")).toHaveCSS("opacity", "1");
    await expectDialogToFit(handover);
    await expect(
      handover.getByRole("heading", {
        name: "Next: Beyond the Dynamo (1902–1921)",
      }),
    ).toBeVisible();
    await expect(handover.getByRole("img", { name: "Met" })).toHaveCount(1);
    await expect(
      handover.getByText("First Light (1882–1901)", { exact: true }),
    ).toHaveCount(0);
    await expect(
      handover.getByText("Retain 90% of customers", { exact: true }),
    ).toBeVisible();
    await expect(handover.getByText("Objectives", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      handover.getByText("Your successor inherits", { exact: true }),
    ).toHaveCount(0);
    await expect(
      handover.getByText("Demand served", { exact: true }),
    ).toHaveCount(0);
    await expect(
      handover.getByText("Demand not met", { exact: true }),
    ).toHaveCount(0);
    const goal = handover.getByText("Retain 90% of customers", { exact: true });
    const [checkBox, goalBox, beginBox, exitBox] = await Promise.all([
      handover.getByRole("img", { name: "Met" }).boundingBox(),
      goal.boundingBox(),
      handover
        .getByRole("button", { name: "Begin next term", exact: true })
        .boundingBox(),
      handover
        .getByRole("button", { name: "Save & exit", exact: true })
        .boundingBox(),
    ]);
    expect(
      Math.abs(
        checkBox!.y + checkBox!.height / 2 - goalBox!.y - goalBox!.height / 2,
      ),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(beginBox!.y - exitBox!.y)).toBeLessThanOrEqual(1);
    await expect(handover.locator(".campaignHandoverActions")).toHaveCSS(
      "border-top-width",
      "0px",
    );
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      theme === "dark" &&
      info.project.name === "mobile-360px"
    ) {
      await page.screenshot({
        animations: "disabled",
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          "legacy-campaign-handover-mobile-dark.png",
        ),
      });
    }
    await page.keyboard.press("Escape");
    await expect(handover).toBeVisible();
    const closed = await readSavedGame(page);
    expect(closed?.campaign?.pendingHandover).toBe(true);
    expect(closed?.date.monthsElapsed).toBe(240);
    await handover
      .getByRole("button", { name: "Save & exit", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(handover).toBeVisible();
    await handover
      .getByRole("button", { name: "Begin next term", exact: true })
      .click();
    await expect(handover).toHaveCount(0);
    const successor = await readSavedGame(page);
    expect(successor?.scenarioId).toBe(118);
    expect(successor?.campaign?.generationIndex).toBe(1);
    expect(successor?.campaign?.completedTerms).toHaveLength(1);
    expect(successor?.date).toEqual(closed?.date);
    expect(successor?.facilities).toEqual(closed?.facilities);
    expect(successor?.customerMarketSize).toBe(closed?.customerMarketSize);
    expect(successor?.customerRate).toBe(closed?.customerRate);
    expect(successor?.dollarsPerkWh).toBe(closed?.dollarsPerkWh);
    expect(successor?.timeline[0].cash).toBe(closed?.timeline[0].cash);
  });
}

test("a later-generation URL opens campaign setup instead of a fresh successor company", async ({
  page,
}, info) => {
  test.skip(!REVIEW_PROJECTS.includes(info.project.name));
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/?scenario=123");
  await expect(
    page.getByRole("heading", { name: "Legacy campaign", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/campaign=legacy/);
  await page
    .getByRole("button", { name: "Start campaign", exact: true })
    .click();
  await expect(page.locator(".facilities:visible")).toBeVisible();
  const game = await readSavedGame(page);
  expect(game?.scenarioId).toBe(117);
  expect(game?.startingYear).toBe(1882);
  expect(game?.campaign?.generationIndex).toBe(0);
});
