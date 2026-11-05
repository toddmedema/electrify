import { expect, Locator, test } from "./fixtures";
import { DIFFICULTY_STORAGE_KEY, unlockedJournal } from "./difficulty-fixture";
import { reviewScreenshot } from "./review-screenshot";

async function expectContinuousBorder(button: Locator) {
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.scrollIntoViewIfNeeded();
  const border = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    const { left, right, top, height } = element.getBoundingClientRect();
    // Grouped buttons overlap by one pixel. Computed colors alone cannot detect
    // the following segment painting over the selected segment's right border.
    return {
      colors: [
        style.borderTopColor,
        style.borderRightColor,
        style.borderBottomColor,
        style.borderLeftColor,
      ],
      ownsEdges: [left + 0.5, right - 0.5].map((x) =>
        element.contains(document.elementFromPoint(x, top + height / 2)),
      ),
    };
  });
  expect(
    new Set(border.colors).size,
    "all selected borders use one color",
  ).toBe(1);
  expect(border.colors[0]).not.toBe("rgba(0, 0, 0, 0)");
  expect(
    border.ownsEdges,
    "neighboring segments must not cover selected borders",
  ).toEqual([true, true]);
}

for (const theme of ["light", "dark"]) {
  test(`difficulty and speed keep continuous selected borders in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    const difficulty = page.getByRole("group", {
      name: "Difficulty",
      exact: true,
    });
    // The opaque locked neighbor must not hide the beginner selection's edge.
    await expectContinuousBorder(
      difficulty.getByRole("button", { name: "Beginner", exact: true }),
    );
    await page.evaluate(
      ({ key, journal }) => {
        localStorage.setItem(key, JSON.stringify(journal));
        dispatchEvent(new StorageEvent("storage", { key }));
      },
      { key: DIFFICULTY_STORAGE_KEY, journal: unlockedJournal },
    );
    for (const name of ["Beginner", "Easy", "Medium", "Hard", "Expert"]) {
      const button = difficulty.getByRole("button", { name, exact: true });
      await button.click();
      await expectContinuousBorder(button);
    }
    await difficulty
      .getByRole("button", { name: "Medium", exact: true })
      .click();
    await page.mouse.move(0, 0);
    await reviewScreenshot(page.locator(".scenarioStartControls"), {
      path: info.outputPath(`difficulty-${theme}.png`),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.locator(".gameStage .facilities")).toBeVisible();
    const speeds = page.getByRole("group", { name: "game speed", exact: true });
    for (const name of [
      "pause",
      "slow speed",
      "normal speed",
      "fast speed",
      "pause",
    ]) {
      const button = speeds.getByRole("button", { name, exact: true });
      await button.click();
      await expectContinuousBorder(button);
    }
    await page.mouse.move(0, 0);
    await reviewScreenshot(page, {
      path: info.outputPath(`speed-${theme}.png`),
      animations: "disabled",
    });
  });

  test(`settings keep continuous selected borders in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    for (const name of ["Appearance", "Text size", "Units"]) {
      const group = page.getByRole("group", { name, exact: true });
      for (const button of await group.getByRole("button").all()) {
        await button.click();
        await expectContinuousBorder(button);
      }
      if (name === "Appearance") {
        await group
          .getByRole("button", {
            name: theme === "light" ? "Light" : "Dark",
            exact: true,
          })
          .click();
      }
    }
    // Keyboard focus must remain above a neighboring selected segment as well.
    const units = page.getByRole("group", { name: "Units", exact: true });
    await units.getByRole("button", { name: "Metric", exact: true }).click();
    await page.keyboard.press("ArrowRight");
    const imperial = units.getByRole("button", {
      name: "Imperial",
      exact: true,
    });
    await expect(imperial).toBeFocused();
    await expect(imperial).toHaveCSS("outline-style", "solid");
    expect(
      await imperial.evaluate((element) => {
        const { left, top, height } = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(left + 0.5, top + height / 2),
        );
      }),
      "keyboard focus stays above the selected neighbor",
    ).toBe(true);
    await page.locator(".screenHeaderTitle").click();
    await page.mouse.move(0, 0);
    await reviewScreenshot(page, {
      path: info.outputPath(`settings-${theme}.png`),
      animations: "disabled",
    });
  });
}
