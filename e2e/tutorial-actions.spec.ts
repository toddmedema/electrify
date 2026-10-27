import { reviewScreenshot } from "./review-screenshot";
import { expect, test } from "./fixtures";

const missions = [
  { name: "Electricity", id: 0, actions: [] },
  { name: "Generators", id: 1, actions: ["Build"] },
  { name: "Storage", id: 2, actions: ["Build"] },
  { name: "Finances", id: 4, actions: ["Build", "Insights"] },
  { name: "Pricing", id: 3, actions: ["Build", "Programs", "Insights"] },
  { name: "Forecasting", id: 5, actions: ["Build", "Programs", "Insights"] },
  {
    name: "Interties",
    id: 112,
    actions: ["Build", "Programs", "Insights", "Events"],
  },
];

for (const [index, mission] of missions.entries()) {
  test(`${mission.name} keeps taught actions and a reachable tutorial target`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(
      ({ previous, theme }) => {
        localStorage.clear();
        localStorage.setItem("theme", theme);
        localStorage.setItem(
          "plays",
          JSON.stringify({
            plays: previous.map((scenarioId) => ({
              scenarioId,
              timesPlayed: 1,
              date: "2026-10-19",
            })),
          }),
        );
      },
      {
        previous: missions.slice(0, index).map((item) => item.id),
        theme: testInfo.project.name.startsWith("mobile-") ? "dark" : "light",
      },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    if (index > 0)
      await page
        .getByRole("button", { name: `Start ${mission.name}`, exact: true })
        .click();
    await expect(page.locator(".tutorialHud")).toBeVisible();
    const dock = page.getByRole("navigation", { name: "Game actions" });
    if (mission.actions.length) {
      await expect(dock).toBeVisible();
      await expect(dock.getByRole("button")).toHaveCount(
        mission.actions.length,
      );
      for (const action of mission.actions)
        await expect(
          dock.getByRole("button", { name: action, exact: true }),
        ).toBeVisible();
    } else await expect(dock).toHaveCount(0);
    await expect(page.locator("#scenarioNav")).toHaveCount(0);

    // Hidden shortcuts must not open tools behind the lesson or bypass the absent score button.
    for (const [action, key] of [
      ["Build", "q"],
      ["Programs", "w"],
      ["Insights", "e"],
      ["Events", "r"],
      ["Scenario", "t"],
    ]) {
      if (!mission.actions.includes(action)) await page.keyboard.press(key);
    }
    if (!mission.actions.includes("Build")) {
      await page.keyboard.press("g");
      await page.keyboard.press("s");
    }
    await expect(page.locator(".gameToolPanel:visible")).toHaveCount(0);
    const target = page.locator(".tutorialTarget").first();
    await expect(target).toBeInViewport();
    await target.click({ trial: true });
    await expect(
      page.locator(".tutorialTargetRing:visible").first(),
    ).toBeVisible();
    if (mission.name === "Generators" || mission.name === "Finances") {
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toBeHidden();
      await reviewScreenshot(page, {
        path: testInfo.outputPath(`${mission.name}-actions.png`),
      });
    }
    if (mission.name === "Generators") {
      const build = dock.getByRole("button", { name: "Build", exact: true });
      await build.click();
      const purchase = page
        .getByRole("button", { name: /Review purchase of/ })
        .first();
      await expect(purchase).toHaveClass(/tutorialTarget/);
      // Tapping an active dock action closes its tool, and the lesson survives reopening it.
      await build.click();
      await expect(
        page.getByRole("region", { name: "Build", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".tutorialHud")).toContainText(
        "Review a generator purchase",
      );
      await build.click();
      await expect(purchase).toHaveClass(/tutorialTarget/);
      await purchase.click({ trial: true });
      await expect(
        page.locator(".tutorialTargetRing:visible").first(),
      ).toBeVisible();
    }
  });
}
