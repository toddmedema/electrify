import path from "node:path";
import { expect, test } from "./fixtures";

for (const theme of ["light", "dark"] as const) {
  test(`changing difficulty keeps the briefing in place in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({
      width: testInfo.project.use.viewport!.width,
      height: 568,
    });
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    const scroller = page.locator("#listCard > .scrollable");
    const difficulties = page.getByRole("group", { name: "Difficulty" });
    await expect(difficulties).toBeVisible();
    await expect(page.locator("main.base_main")).toHaveCount(1);
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await difficulties.scrollIntoViewIfNeeded();
    expect(
      await scroller.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);

    for (const difficulty of ["Beginner", "Hard", "Expert", "Easy"]) {
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await difficulties.scrollIntoViewIfNeeded();
      const button = difficulties.getByRole("button", {
        name: difficulty,
        exact: true,
      });
      const before = await scroller.evaluate((element) => element.scrollTop);
      const position = (await button.boundingBox())!;
      // A physical click avoids Playwright scrolling the control on our behalf.
      await page.mouse.click(
        position.x + position.width / 2,
        position.y + position.height / 2,
      );
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await expect
        .poll(async () =>
          Math.abs(
            (await scroller.evaluate((element) => element.scrollTop)) - before,
          ),
        )
        .toBeLessThanOrEqual(1);
    }

    const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
    if (
      reviewDir &&
      ((theme === "light" && testInfo.project.name === "desktop-chromium") ||
        (theme === "dark" && testInfo.project.name === "mobile-390px"))
    ) {
      await expect(page.locator(".leaderboard")).not.toContainText(
        "Loading...",
      );
      await expect(
        page.locator(".difficultyPicker .MuiTouchRipple-ripple"),
      ).toHaveCount(0);
      await page.setViewportSize(testInfo.project.use.viewport!);
      await scroller.evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          reviewDir,
          `difficulty-${testInfo.project.name}-${theme}.png`,
        ),
      });
    }
  });
}
