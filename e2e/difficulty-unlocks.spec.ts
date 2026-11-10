import path from "node:path";
import { expect, test } from "./fixtures";
import { DIFFICULTY_STORAGE_KEY } from "./difficulty-fixture";
import { readSavedGame } from "./save-fixture";
import manifest from "../src/data/RunCompatibility.json";

for (const theme of ["light", "dark"]) {
  test(`locked levels explain their requirements and react to progress in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      if (!sessionStorage.getItem("difficulty-test-ready")) {
        localStorage.clear();
        sessionStorage.setItem("difficulty-test-ready", "true");
      }
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    const picker = page.getByRole("group", { name: "Difficulty", exact: true });
    const beginner = picker.getByRole("button", {
      name: "Beginner",
      exact: true,
    });
    await expect(beginner).toHaveAttribute("aria-pressed", "true");
    const expert = picker.getByRole("button", {
      name: "Expert, locked",
      exact: true,
    });
    for (const name of ["Easy", "Medium", "Hard", "Expert"]) {
      const locked = picker.getByRole("button", {
        name: `${name}, locked`,
        exact: true,
      });
      await expect(locked).toHaveAttribute("aria-disabled", "true");
      await expect(locked.locator("svg")).toHaveCount(1);
    }
    // aria-disabled blocks selection; a physical tap/click still explains the lock.
    await expert.scrollIntoViewIfNeeded();
    const lockedBounds = (await expert.boundingBox())!;
    await page.mouse.click(
      lockedBounds.x + lockedBounds.width / 2,
      lockedBounds.y + lockedBounds.height / 2,
    );
    const hint = page.locator(".difficultyLockHint");
    await expect(hint).toContainText(
      "Complete an official non-tutorial scenario on Hard to unlock Expert.",
    );
    await expect(beginner).toHaveAttribute("aria-pressed", "true");
    await picker
      .getByRole("button", { name: "Easy, locked", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(hint).toContainText("on Beginner to unlock Easy");
    await expect(beginner).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    for (const control of await picker.getByRole("button").all()) {
      const bounds = (await control.boundingBox())!;
      expect(bounds.height).toBeGreaterThanOrEqual(
        info.project.name.startsWith("mobile") ? 44 : 40,
      );
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        page.viewportSize()!.width + 1,
      );
    }
    const warningBounds = (await page.getByRole("note").boundingBox())!;
    const controlBounds = (await page
      .locator(".scenarioStartControls")
      .boundingBox())!;
    expect(warningBounds.y + warningBounds.height).toBeLessThanOrEqual(
      controlBounds.y,
    );
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.locator(".leaderboard").getByRole("table").waitFor();
      await expect(page.locator(".leaderboard")).not.toContainText(
        "Loading...",
      );
      await page.locator("#listCard > .scrollable").evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.locator(".screenHeaderTitle").click();
      await expect(picker.locator(".MuiTouchRipple-ripple")).toHaveCount(0);
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `unlocks-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
      await page.locator(".scenarioDossier").screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `unlocks-dossier-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
    // Another tab / cloud synchronization publishes the same durable, validated win history.
    await page.evaluate((key) => {
      const progress = {
        version: 1,
        earned: [],
        tutorials: [],
        wins: ["100:Intern"],
      };
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, guest: progress, accounts: {} }),
      );
      dispatchEvent(new StorageEvent("storage", { key }));
    }, DIFFICULTY_STORAGE_KEY);
    const easy = picker.getByRole("button", { name: "Easy", exact: true });
    await expect(easy).toHaveAttribute("aria-disabled", "false");
    await easy.click();
    await expect(easy).toHaveAttribute("aria-pressed", "true");
    await expect(hint).toContainText("on Easy to unlock Medium");
    // A different scenario sees the same account-wide unlock, which survives a refresh.
    await page.evaluate(() => {
      history.pushState(null, "", "/?scenario=101");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.reload();
    await expect(
      picker.getByRole("button", { name: "Easy", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.locator("#appbar:visible").first()).toBeVisible();
    await page.evaluate(() => dispatchEvent(new Event("pagehide")));
    expect((await readSavedGame(page))!.difficulty).toBe("Employee");
  });
}

test("a locked friend challenge keeps its advertised rules and explains why it cannot start", async ({
  page,
}) => {
  const challenge = {
    run: {
      scenarioId: 101,
      difficulty: "CEO",
      seed: 42,
      compatibilityId: manifest.compatibilityId,
    },
    target: 500,
  };
  await page.goto(
    `/?challenge=${encodeURIComponent(JSON.stringify(challenge))}`,
  );
  await expect(
    page.getByRole("button", { name: "Start challenge", exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator(".scenarioStartControls").getByRole("status"),
  ).toContainText("on Hard to unlock Expert");
  await expect(
    page.getByRole("group", { name: "Difficulty", exact: true }),
  ).toHaveCount(0);
});
