import path from "path";
import { expect, test } from "./fixtures";

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
      "Demand served",
    );
    await expect(hud.locator(".gridHealthTime")).toHaveText("Now");
    await expect(
      hud.getByRole("button", { name: "pause", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      hud.getByRole("button", { name: "All requirements" }),
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
