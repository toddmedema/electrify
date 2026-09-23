import { expect, test } from "@playwright/test";
import { isPaneLayout, waitForPaneOrNav, waitForSettled } from "./layout";

for (const mission of [
  "Generators",
  "Storage",
  "Pricing",
  "Finances",
  "Forecasting",
]) {
  test(`${mission} advances from game controls`, async ({ page }, testInfo) => {
    await page.addInitScript(
      ({ lesson, theme }) => {
        localStorage.clear();
        localStorage.setItem("theme", theme);
        localStorage.setItem(
          "plays",
          JSON.stringify({
            plays: [0, 1, 2, 4, 3, 5]
              .slice(
                0,
                [
                  "Electricity",
                  "Generators",
                  "Storage",
                  "Finances",
                  "Pricing",
                  "Forecasting",
                ].indexOf(lesson),
              )
              .map((scenarioId) => ({
                scenarioId,
                timesPlayed: 1,
                date: "2026-09-10",
              })),
          }),
        );
      },
      {
        lesson: mission,
        theme: testInfo.project.name.startsWith("mobile-") ? "dark" : "light",
      },
    );
    await page.goto("/");
    await page
      .getByRole("button", { name: "Start playing", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Start ${mission}`, exact: true })
      .click();
    const hud = page.locator(".tutorialHud");
    if (mission === "Generators" || mission === "Storage") {
      await page.locator(".button-buildFacility").click();
      if (mission === "Storage") {
        const storageTab = page.getByRole("tab", {
          name: "Storage",
          exact: true,
        });
        await expect(hud).toContainText("Tap Storage");
        await expect(storageTab).toHaveClass(/tutorialTarget/);
        await storageTab.click();
      }
      await expect(hud).toContainText(
        mission === "Generators" ? "Review a generator" : "Review a storage",
      );
      await page
        .getByRole("button", { name: /Review purchase of/ })
        .first()
        .click();
      // Reviewing and approving are distinct steps; highlight the payment controls in the dialog.
      await expect(hud).toContainText("Buy it with cash, or take a loan");
      await expect(
        page.getByRole("button", { name: "Take loan", exact: true }),
      ).toHaveClass(/tutorialTarget/);
      await page
        .getByRole("button", { name: "Take loan", exact: true })
        .click();
      await expect(hud).toContainText(
        mission === "Generators"
          ? "Construction started"
          : "bar shows usable stored energy",
      );
    } else if (mission === "Forecasting") {
      await page.locator(".facilityRow .facilityDisclosure").first().click();
      await page
        .getByRole("button", { name: "Pause Coal", exact: true })
        .click();
      // The step after the pause is the navigation itself. Wide layouts advance it on their
      // own; narrow layouts wait for the player to tap the bottom navigation.
      if (!isPaneLayout(page)) {
        await expect(
          page.getByRole("heading", { name: "Step 3 of 14" }),
        ).toBeVisible();
        // The card transition briefly mounts the outgoing layout beside the new one
        await waitForSettled(page, "#insightsNav");
        await expect(page.locator("#insightsNav")).toHaveClass(
          /tutorialTarget/,
        );
        await page.locator("#insightsNav").click();
      }
      await expect(
        page.getByRole("heading", { name: "Step 4 of 14" }),
      ).toBeVisible();
    } else {
      const nav = page.locator("#insightsNav");
      await waitForPaneOrNav(page.locator(".insights"), nav);
      // In the pane layout the navigation step advanced on its own, so there is no Next to
      // press and the click is at most a no-op on the card it already opened
      if (await nav.isVisible()) {
        await nav.click();
      }
      if (mission === "Pricing") {
        await expect(hud).toContainText("Drag the rate slider");
        const rate = page.locator("#rateSlider input");
        await rate.focus();
        await rate.press("ArrowLeft");
        await expect(hud).toContainText("Find customer growth");
      } else {
        await expect(hud).toContainText("Change the chart time period");
        // Short tutorials open on their whole run, already the narrowest span.
        await page
          .getByRole("button", { name: "Zoom out", exact: true })
          .click();
        await expect(hud).toContainText(
          "Tap Layers, or choose a preset question",
        );
        await page.locator("#insightsLayersButton").click();
        await expect(hud).toContainText("Tap 1× to run the month");
      }
    }
    await expect(page.locator(".buildOption")).toHaveCount(0);
    if (mission === "Generators" || mission === "Storage") {
      await expect(
        page.locator(".facilityRowHeader.tutorialTarget").first(),
      ).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath(`${mission}-advanced.png`),
    });
    if (mission === "Finances") {
      await page.locator("#insightsLayersButton").click();
      await page
        .getByRole("button", { name: "slow speed", exact: true })
        .click();
      await expect(hud).toContainText(
        "Set a rate that turns next month’s loss into profit",
      );
      await expect(
        page.getByRole("button", { name: "slow speed", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toBeHidden();
      await page.screenshot({
        path: testInfo.outputPath("finances-running.png"),
      });
    }
    if (mission === "Generators") {
      const progress = page.getByRole("progressbar", { name: "Year progress" });
      await expect(progress).toHaveAttribute("aria-valuenow", "0");
      const initialBox = await progress.boundingBox();
      expect(initialBox!.width).toBeGreaterThan(300);
      await hud.getByRole("button", { name: "Next" }).click();
      await expect(hud).toContainText("Tap 20× to start construction time");
      await page
        .getByRole("button", { name: "slow speed", exact: true })
        .click();
      await expect(hud).toContainText("Tap 20× to start construction time");
      const fastSpeed = page.getByRole("button", {
        name: "fast speed",
        exact: true,
      });
      await expect(fastSpeed).toHaveClass(/tutorialTarget/);
      await fastSpeed.click();
      await expect(hud).toContainText("Watch the year bar advance");
      await expect(progress).toHaveClass(/tutorialTarget/);
      await expect(page.locator(".tutorialTargetRing")).toBeVisible();
      await expect(progress).not.toHaveAttribute("aria-valuenow", "0");
      expect((await progress.boundingBox())!.width).toBe(initialBox!.width);
      await page.screenshot({ path: testInfo.outputPath("year-progress.png") });
      await hud.getByRole("button", { name: "Next" }).click();
      await expect(hud).toContainText(
        "Order a second generator of a different type",
      );
      await expect(progress).not.toHaveClass(/tutorialTarget/);
    }
  });
}
