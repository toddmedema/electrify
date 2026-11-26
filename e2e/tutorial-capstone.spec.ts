import { readTutorialSupplyChart } from "./tutorial-fixture";
import { TUTORIALS } from "../src/data/Scenarios";
import { reviewScreenshot } from "./review-screenshot";
import { expectDialogActionsOnOneRow } from "./dialog-layout";
import { expect, test, type Page, type TestInfo } from "./fixtures";

async function completeMission(
  page: Page,
  testInfo: TestInfo,
  keepPlaying: boolean,
) {
  await page.addInitScript(
    (theme) => {
      window.localStorage.clear();
      window.localStorage.setItem("theme", theme);
    },
    testInfo.project.name.startsWith("mobile-") ? "dark" : "light",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Tutorials", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Step 1 of 5" }),
  ).toBeVisible();
  await expect(page.locator(".tutorialHud")).toContainText(
    "Inspect the coal plant on the map",
  );
  await expect(page.locator("#navfooter")).toBeHidden();
  await expect(page.locator(".gameMenuButton")).toBeHidden();
  await expect(page.locator("#speedChangeButtons")).toBeHidden();
  const expectObjectiveDocked = async () => {
    const objective = page.locator(".tutorialHud");
    const game = page.locator(".cardTransitions");
    const [objectiveBox, gameBox] = await Promise.all([
      objective.boundingBox(),
      game.boundingBox(),
    ]);
    expect(objectiveBox).not.toBeNull();
    expect(gameBox).not.toBeNull();
    expect(objectiveBox!.y + objectiveBox!.height).toBeLessThanOrEqual(
      gameBox!.y + 1,
    );
    expect(
      await objective.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  };
  await expectObjectiveDocked();

  await readTutorialSupplyChart(page);
  if (testInfo.project.name.startsWith("mobile-")) {
    const speedButtons = page.locator("#speedChangeButtons button");
    for (let i = 0; i < (await speedButtons.count()); i++) {
      const box = await speedButtons.nth(i).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  }

  await expect(
    page.getByRole("button", { name: "Fleet", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "normal speed" }).click();
  await expect(
    page.getByText("Reach midnight without a blackout"),
  ).toBeVisible();
  // The clock keeps running into the capstone, so stop it while the setup below is arranged
  await page.getByRole("button", { name: "pause", exact: true }).click();
  await expect(
    page.getByText("Solar fades in the evening, so coal picks up the load."),
  ).toBeVisible();
  await expect(page.locator(".tutorialHudHint")).toHaveCount(0);
  await expectObjectiveDocked();
  await page.screenshot({ path: testInfo.outputPath("capstone.png") });

  // Remove firm capacity so the first attempt demonstrates consequence feedback and retry. The
  // objective is docked outside the game surface, so the same control remains operable at every
  // viewport without a small-screen workaround.
  const coal = page
    .getByRole("region", { name: "Fleet", exact: true })
    .locator('.facilityRow[data-facility="Coal"]');
  const disclosure = coal.locator(".facilityDisclosure");
  const pauseCoal = coal.getByRole("button", {
    name: "Pause Coal",
    exact: true,
  });
  if ((await disclosure.getAttribute("aria-expanded")) !== "true")
    await disclosure.click();
  await pauseCoal.click();
  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByRole("heading", { name: "Final challenge needs another try" }),
  ).toBeVisible();
  await expect(page.getByText("Demand exceeded supply")).toBeVisible();

  await page.getByRole("button", { name: "Retry final challenge" }).click();
  await expect(
    page.getByText("Reach midnight without a blackout"),
  ).toBeVisible();
  if ((await disclosure.getAttribute("aria-expanded")) !== "true")
    await disclosure.click();
  await expect(pauseCoal).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume Coal", exact: true }),
  ).toHaveCount(0);

  if (!keepPlaying) {
    // Mission 1 can be the last tutorial the player completes.
    await page.evaluate(
      (ids) => {
        localStorage.setItem(
          "plays",
          JSON.stringify({
            plays: ids.map((scenarioId) => ({
              scenarioId,
              date: new Date().toISOString(),
              timesPlayed: 1,
            })),
          }),
        );
      },
      TUTORIALS.slice(1).map(({ id }) => id),
    );
  }
  await page.getByRole("button", { name: "fast speed" }).click();
  await expect(
    page.getByRole("heading", { name: /Mission complete!/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Install for later" }),
  ).toHaveCount(0);
  await reviewScreenshot(page.getByRole("dialog"), {
    path: testInfo.outputPath("mission-complete.png"),
    animations: "disabled",
  });
  // The handoff names the next mission, its place in the sequence, and what it covers
  const completionDialog = page.getByRole("dialog");
  await expect(
    completionDialog.getByText("Up next: Mission 2 of 7: Generators"),
  ).toBeVisible();
  await expect(
    completionDialog.getByText("Build a generator", { exact: true }),
  ).toBeVisible();
  const primary = completionDialog.getByRole("button", {
    name: "Next tutorial",
    exact: true,
  });
  const secondary = completionDialog.getByRole("button", {
    name: "Menu",
    exact: true,
  });
  await expect(primary).toBeVisible();
  await expect(secondary).toBeVisible();
  const practice = completionDialog.getByRole("button", {
    name: /^(Practice|Keep playing)$/,
  });
  await expect(practice).toBeVisible();
  await expectDialogActionsOnOneRow(
    completionDialog,
    4,
    testInfo.project.use.hasTouch ? 44 : 40,
  );
  await expect(primary).toBeFocused();
  const shareFeedback = completionDialog.getByRole("button", {
    name: "Feedback",
    exact: true,
  });
  if (keepPlaying) {
    await expect(shareFeedback).toHaveClass(/MuiButton-text/);
    const fleetBefore = await page.locator(".facilityRow").allTextContents();
    const clock = page.locator("#appbar [data-game-minute]");
    const minuteBefore = await clock.getAttribute("data-game-minute");
    expect(minuteBefore).toMatch(/^\d+$/);
    await practice.click();
    await expect(completionDialog).toBeHidden();
    await expect(page.locator(".tutorialHud")).toHaveCount(0);
    expect(await page.locator(".facilityRow").allTextContents()).toEqual(
      fleetBefore,
    );
    await expect(clock).toHaveAttribute("data-game-minute", minuteBefore!);
    await page.getByRole("button", { name: "normal speed" }).click();
    await expect(
      page.getByRole("button", { name: "pause", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => Number(await clock.getAttribute("data-game-minute")))
      .toBeGreaterThan(Number(minuteBefore));
    return;
  }
  await expect(shareFeedback).toHaveClass(/MuiButton-outlined/);
  await shareFeedback.click();
  const feedback = page.getByRole("dialog", { name: "Share feedback" });
  await expect(
    feedback.getByRole("textbox", { name: "Your feedback" }),
  ).toBeFocused();
  let received: unknown;
  await page.route("**/submitGameFeedback", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": new URL(page.url()).origin,
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    received = route.request().postDataJSON();
    await route.fulfill({ headers, json: { result: { sent: true } } });
  });
  await feedback
    .getByRole("textbox", { name: "Your feedback" })
    .fill("The capstone helped.");
  await reviewScreenshot(feedback, {
    path: testInfo.outputPath("share-feedback.png"),
    animations: "disabled",
  });
  await feedback.getByRole("button", { name: "Send feedback" }).click();
  await expect(feedback.getByRole("status")).toHaveText(
    "Thanks for sharing your feedback.",
  );
  expect(received).toMatchObject({
    data: {
      source: "tutorial",
      scenarioId: TUTORIALS[0].id,
      message: "The capstone helped.",
      replyEmail: "",
    },
  });
  await expect(feedback.getByRole("button", { name: "Done" })).toBeFocused();
  await feedback.getByRole("button", { name: "Done" }).click();
  await expect(shareFeedback).toBeFocused();
  await primary.click();
  await expect(
    page.getByRole("region", { name: "Step 1 of 3", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tutorialHudAction")).toHaveText(
    "Build a gas peaker",
  );
}

test("guided objective reaches a retryable capstone and succeeds", async ({
  page,
}, testInfo) => {
  await completeMission(page, testInfo, false);
});

test("completed tutorial keeps its setup playable", async ({
  page,
}, testInfo) => {
  await completeMission(page, testInfo, true);
});
