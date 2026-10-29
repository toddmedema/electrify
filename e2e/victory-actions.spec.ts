import { openPane } from "./layout";
import { editSavedGame, readSavedGame } from "./save-fixture";
import { expectDialogToFit } from "./dialog-layout";
import path from "path";
import { expect, test, Page } from "./fixtures";
import { getScenario } from "../src/data/Scenarios";
import { resolveStoryAtDate } from "../src/data/WorldEvents";
import { getDateFromMinute, summarizeTimeline } from "../src/helpers/DateTime";
import {
  initializeGameObjectiveProgress,
  recordGameObjectiveMonth,
} from "../src/helpers/ObjectiveRules";
import { scenarioRules } from "../src/helpers/ScenarioRules";
import {
  buildStoryPeriodSnapshot,
  buildStorySnapshot,
} from "../src/helpers/Story";
import { parseSave } from "../src/SaveGame";
import type { GameType } from "../src/Types";

/** Exercise populated standings through the real native-score adapter, without a native window. */
async function installLeaderboardFixture(page: Page, currentRank: number) {
  await page.addInitScript((rank) => {
    const display = {
      fullscreen: false,
      width: 1280,
      height: 800,
      resolutions: [],
    };
    const steamId = "76561198000000001";
    let submitted:
      | {
          scenarioId: number;
          difficulty: GameType["difficulty"];
          score: number;
        }
      | undefined;
    const noop = () => () => {};
    window.electrifyDesktop = {
      apiVersion: 1,
      getState: async () => ({
        display,
        steam: {
          available: true,
          online: true,
          cloudEnabled: false,
          steamId,
          displayName: "Daniel McEntee",
        },
      }),
      setDisplay: async () => display,
      onStateChanged: noop,
      onGameFocusChanged: noop,
      onBeforeQuit: noop,
      readyToQuit: () => {},
      quit: async () => {},
      openFriends: async () => {},
      readSaveLibrary: async () => ({
        local: null,
        cloud: null,
        cloudState: "disabled",
      }),
      writeSaveLibrary: async () => ({ cloudState: "disabled" }),
      submitScore: async ({ scenarioId, difficulty, score }) => {
        submitted = { scenarioId, difficulty, score: Math.round(score) };
      },
      getLeaderboard: async (selection) =>
        selection.scope === "player"
          ? submitted
            ? [
                {
                  ...submitted,
                  steamId,
                  displayName: "Daniel McEntee",
                  rank,
                },
              ]
            : []
          : [
              "Lakeside Municipal Electricity Cooperative",
              "Northern Wind",
              "Solar operator",
            ].map((displayName, i) => ({
              steamId: `7656119800000000${i + 2}`,
              displayName,
              score: 1000 - i * 100,
              rank: i + 1,
              scenarioId: selection.scenarioId,
              difficulty: selection.difficulty || "VP",
            })),
    };
  }, currentRank);
}

/** Synthetic history still needs the same story receipts and objective evidence as real play. */
function rebuildCompletionEvidence(game: GameType): void {
  const finalDate = game.date;
  const months = [...game.monthlyHistory].reverse();
  const scenario = getScenario(game.scenarioId)!;
  const rules = scenarioRules(scenario, game);
  game.monthlyHistory = [];
  game.worldEvents = { active: [], occurrences: [], checkedKeys: [] };
  game.date = getDateFromMinute(0, game.startingYear);
  initializeGameObjectiveProgress(game);
  for (let month = 0; month <= months.length; month++) {
    game.date = getDateFromMinute(month * 1440, game.startingYear);
    const story = resolveStoryAtDate({
      rules,
      seed: game.seed,
      scenarioId: game.scenarioId,
      difficulty: game.difficulty,
      date: game.date,
      location: game.location,
      snapshot: buildStorySnapshot(
        game.monthlyHistory,
        game.facilities,
        game.date.minute,
      ),
      occurrences: game.worldEvents.occurrences,
      monthlyHistory: game.monthlyHistory,
      completedMonths: month,
      startingRateDollarsPerKWh: scenario.dollarsPerkWh,
      endingRateDollarsPerKWh: game.dollarsPerkWh,
      periodSnapshots: Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((period) => [
          period,
          buildStoryPeriodSnapshot(game.monthlyHistory, period),
        ]),
      ),
    });
    game.worldEvents.occurrences.push(...story.occurrences);
    game.worldEvents.checkedKeys.push(
      ...story.occurrences.map(({ key }) => key),
    );
    game.worldEvents.active = story.active;
    if (month < months.length) {
      const row = months[month];
      game.monthlyHistory.unshift(row);
      game.date = getDateFromMinute((month + 1) * 1440, game.startingYear);
      recordGameObjectiveMonth(game, row);
    }
  }
  game.date = finalDate;
}

for (const { theme, native, currentRank } of [
  { theme: "light", native: false, currentRank: 47 },
  { theme: "dark", native: false, currentRank: 47 },
  { theme: "dark", native: true, currentRank: 47 },
  { theme: "light", native: true, currentRank: 12345 },
] as const) {
  test(`victory actions remain usable and replay the scenario in ${theme}${native ? " with native leaderboard" : ""}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    if (native) await installLeaderboardFixture(page, currentRank);
    await page.goto("/?scenario=101");
    await page.getByRole("button", { name: "Hard", exact: true }).click();
    // Web production omits the native adapter; its public-board path remains covered too.
    const nativeBoard =
      (await page.getByRole("group", { name: "Steam leaderboard" }).count()) >
      0;
    test.skip(
      native && !nativeBoard,
      "Native standings require the desktop-enabled renderer",
    );
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await page
      .getByRole("button", { name: "fast speed", exact: true })
      .first()
      .click();
    await expect(
      page.locator("#appbar:visible .gameStatusValue.weak"),
    ).not.toContainText("Jan 2002");
    await page
      .getByRole("button", { name: "pause", exact: true })
      .first()
      .click();
    // Move a real save to its final tick to exercise the actual completed-run flow.
    await editSavedGame(page, (save) => {
      const realMonth = save.game.monthlyHistory[0];
      expect(realMonth).toBeDefined();
      save.game.monthlyHistory = Array.from({ length: 143 }, (_, index) => ({
        ...realMonth,
        year: save.game.startingYear + Math.floor((142 - index) / 12),
        month: ((142 - index) % 12) + 1,
      }));
      // The forecast spans a whole month; align its first tick rather than the live cursor.
      const offset = 143 * 1440 - save.game.timeline[0].minute;
      save.game.date = getDateFromMinute(
        144 * 1440 - 15,
        save.game.startingYear,
      );
      for (const tick of save.game.timeline) tick.minute += offset;
      expect(
        summarizeTimeline(save.game.timeline, save.game.startingYear),
      ).toMatchObject({
        year: save.game.startingYear + 11,
        month: 12,
      });
      // Every difficulty now requires at least one meaningful decision to win.
      save.game.meaningfulDecisions = [
        {
          key: "rate",
          lever: "rate",
          label: "Changed the retail rate",
          month: 1,
          kind: "rate",
          before: "$0.10/kWh",
          after: "$0.11/kWh",
        },
      ];
      rebuildCompletionEvidence(save.game);
      expect(parseSave(save)).not.toBeNull();
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .locator("#appbar:visible")
      .getByRole("button", { name: "normal speed", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Mission complete" });
    await expect(dialog).toBeVisible();
    const leaderboard = dialog.getByRole("region", {
      name: "Leaderboard · Hard",
    });
    await expect(leaderboard).toBeAttached();
    await expect(dialog.locator(".victoryScoreBreakdown")).toContainText(
      "Service",
    );
    await expect(dialog.locator(".victoryScoreBreakdown")).toContainText(
      "Financial performance",
    );
    await expect(dialog.locator(".victoryScoreBreakdown")).toContainText(
      "Environmental impact",
    );
    await expect(dialog.locator(".victoryScoreBreakdown")).not.toContainText(
      "final customers",
    );
    await expect(
      dialog.getByRole("region", { name: "Mission results" }),
    ).toContainText("final net worth");
    const popup = page.locator(".achievementToastPanel");
    if (!nativeBoard) {
      await expect(popup).toBeVisible();
      await expect(popup).toContainText("Staying Power");
      await expect
        .poll(() =>
          popup.evaluate((el) => {
            const bounds = el.getBoundingClientRect();
            return el.contains(
              document.elementFromPoint(bounds.right - 24, bounds.top + 24),
            );
          }),
        )
        .toBe(true);
    }
    // Dismiss queued awards so the remaining result-action checks can use the whole dialog.
    while (await popup.isVisible()) {
      await popup.getByRole("button", { name: /^Dismiss/ }).click();
    }
    await leaderboard.scrollIntoViewIfNeeded();
    await expect(leaderboard).toBeVisible();
    if (nativeBoard) {
      await expect(leaderboard.getByRole("row")).toHaveCount(4);
      await expect(leaderboard.getByRole("columnheader")).toHaveCount(0);
      await expect(
        leaderboard.getByRole("row", { name: "This run" }),
      ).toContainText(`${currentRank.toLocaleString("en-US")}Daniel McEntee`);
      await expect(
        leaderboard
          .getByRole("row", { name: "This run" })
          .getByRole("cell")
          .last(),
      ).toHaveText(
        (await dialog
          .getByLabel(/^Final score/)
          .locator("strong")
          .textContent()) || "",
      );
      await expect(
        leaderboard.getByRole("cell", {
          name: "Lakeside Municipal Electricity Cooperative",
        }),
      ).toBeVisible();
      const rankCell = leaderboard
        .getByRole("row", { name: "This run" })
        .getByRole("cell")
        .first();
      expect(
        await rankCell.evaluate((el) => getComputedStyle(el).whiteSpace),
      ).toBe("nowrap");
      expect(
        await leaderboard.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    await expect(dialog.locator("..")).toHaveCSS("opacity", "1");
    await expectDialogToFit(dialog);
    const newGame = dialog.getByRole("button", {
      name: "New game",
      exact: true,
    });
    const replay = dialog.getByRole("button", { name: "Replay", exact: true });
    await expect(newGame).toBeVisible();
    // Read the pair together: late standings can reposition the centered dialog.
    const [replayBox, newBox] = await dialog
      .locator(".victoryNextActions button")
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const { x, y, width } = button.getBoundingClientRect();
          return { x, y, width };
        }),
      );
    expect(replayBox.y).toBe(newBox.y);
    expect(newBox.x).toBeGreaterThan(replayBox.x + replayBox.width);
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    for (const button of await dialog
      .locator(".victoryDialogActions button")
      .all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(
        info.project.use.hasTouch ? 44 : 40,
      );
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.mouse.move(0, 0);
      await dialog.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `victory-${info.project.name}-${theme}${native ? "-native" : ""}.png`,
        ),
      });
    }
    await dialog
      .getByRole("button", { name: /Challenge a friend|Share result/ })
      .click();
    const preview = page.getByRole("dialog", {
      name: /Challenge a friend|Share result/,
    });
    await expectDialogToFit(preview);
    await preview.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(preview).toHaveCount(0);
    await replay.click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("#appbar:visible").first()).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    const restarted = (await readSavedGame(page))!;
    expect(restarted.scenarioId).toBe(101);
    expect(restarted.difficulty).toBe("VP");
    expect(restarted.date.monthsElapsed).toBe(0);
  });
}

test("retrying a failed scenario keeps its difficulty in the game and mission details", async ({
  page,
}, info) => {
  const theme = info.project.use.hasTouch ? "dark" : "light";
  await page.addInitScript((mode) => {
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem("theme", mode);
  }, theme);
  await page.goto("/?scenario=101");
  await page.getByRole("button", { name: "Expert", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const requirements = page
    .locator("#navfooter:visible")
    .getByRole("button", { name: "Scenario", exact: true })
    .first();
  const details = page.getByRole("region", { name: "Scenario", exact: true });
  await openPane(details, requirements);
  await expect(details.getByText("Expert", { exact: true })).toBeVisible();
  await expect(details).toContainText("Rise of Renewables");
  await details.getByRole("button", { name: "Close Scenario" }).click();

  // Force insolvency at the next month boundary through a real saved game.
  await editSavedGame(page, (save) => {
    save.game.lowCashWarningMonth = save.game.date.monthsElapsed;
    for (const tick of save.game.timeline) {
      tick.cash = -1000000000;
    }
  });
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "fast speed", exact: true })
    .first()
    .click();
  const failure = page.getByRole("dialog", { name: "Bankrupt!" });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText(
    "Complete the mission to join the leaderboard and set a personal best.",
  );
  await expect(failure.locator(".victoryScoreBreakdown")).toContainText(
    "Service",
  );
  await expect(failure).not.toContainText("New personal best");
  await expect(failure.locator(".resultLeaderboard")).toHaveCount(0);
  await expect(
    failure.getByRole("region", { name: "Mission results" }),
  ).toContainText("customers");
  await failure.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(failure).not.toBeVisible();
  await expect(page.locator("#appbar:visible").first()).toBeVisible();

  const restarted = (await readSavedGame(page))!;
  expect(restarted.scenarioId).toBe(101);
  expect(restarted.difficulty).toBe("CEO");
  expect(restarted.date.monthsElapsed).toBe(0);
  await openPane(details, requirements);
  await expect(details.getByText("Expert", { exact: true })).toBeVisible();
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await expect(details.locator("..")).toHaveCSS("opacity", "1");
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `retry-difficulty-${info.project.name}-${theme}.png`,
      ),
    });
  }
});
