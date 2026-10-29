import { expect, test } from "./fixtures";
import { reviewScreenshot } from "./review-screenshot";
import {
  isPaneLayout,
  sortBuildCatalog,
  waitForPaneOrNav,
  waitForSettled,
} from "./layout";

for (const mission of [
  "Generators",
  "Storage",
  "Pricing",
  "Finances",
  "Forecasting",
]) {
  test(`${mission} advances from game controls`, async ({ page }, testInfo) => {
    if (
      mission === "Finances" &&
      testInfo.project.name === "desktop-chromium"
    ) {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
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
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page
      .getByRole("button", { name: `Start ${mission}`, exact: true })
      .click();
    const hud = page.locator(".tutorialHud");
    await expect(hud).toBeVisible();
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
      if (mission === "Generators") {
        await expect(hud).toContainText("Sort generators");
        await sortBuildCatalog(page);
      }
      await expect(hud).toContainText(
        mission === "Generators" ? "Review a generator" : "Review a storage",
      );
      // These steps advance from the review control; Next remains an optional fallback.
      await expect(hud.locator(".tutorialHudContinue")).toHaveCount(0);
      await expect(hud.locator(".tutorialHudNextPulse")).toHaveCount(0);
      await expect(
        hud.getByRole("button", { name: "Next", exact: true }),
      ).not.toHaveClass(/MuiButton-contained/);
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
          : "vertical bar shows how much energy is stored",
      );
    } else if (mission === "Forecasting") {
      await page.locator(".facilityRow .facilityDisclosure").first().click();
      await page
        .getByRole("button", { name: "Pause Coal", exact: true })
        .click();
      // The step after the pause teaches opening Insights from the game dock.
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
      const nav = page.locator(
        mission === "Pricing" ? "#programsNav" : "#insightsNav",
      );
      await waitForPaneOrNav(
        page.locator(
          mission === "Pricing" ? ".customerProgramsBody" : ".insights",
        ),
        nav,
      );
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
        // A one-month tutorial is already at the minimum zoom and spans the whole scenario.
        // Fit full timeline expands to the longer forecast rather than pressing disabled zoom.
        await page
          .getByRole("button", { name: "Fit full timeline", exact: true })
          .click();
        await expect(hud).toContainText(
          "Tap Layers, or choose a preset question",
        );
        await page.locator("#insightsLayersButton").click();
        await expect(hud).toContainText("Tap Programs");
        await expect(
          page.getByRole("region", { name: "Insights", exact: true }),
        ).toBeVisible();
        await expect(page.locator("#programsNav")).toHaveClass(
          /tutorialTarget/,
        );
        await page.locator("#programsNav").click();
        await expect(hud).toContainText("Raise the electricity rate");
        if (
          (await page.locator(".gameStage").getAttribute("data-layout")) ===
          "side"
        ) {
          await expect(
            page.getByRole("region", { name: "Insights", exact: true }),
          ).toBeVisible();
          await expect(page.locator("#chartFinances")).toBeVisible();
          await page.locator("#insightsLayersButton").click();
          await expect(page.locator("#insightsLayersButton")).toHaveAttribute(
            "aria-expanded",
            "false",
          );
        }
        await expect(page.locator("#rateSlider")).toHaveClass(/tutorialTarget/);
        await page.mouse.move(0, 0);
        await reviewScreenshot(page, {
          path: testInfo.outputPath("programs-and-insights.png"),
          animations: "disabled",
        });
        const rate = page.locator("#rateSlider input");
        await rate.focus();
        await rate.press("ArrowRight");
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
      await page
        .locator(
          ".facilityRowHeader:has(.constructionProgress) .facilityDisclosure",
        )
        .click();
      await expect(
        page.locator(".facilityRow.selected .facilityDetails"),
      ).toBeVisible();
      await expect(hud).toContainText("Tap 12× to start construction time");
      await page
        .getByRole("button", { name: "slow speed", exact: true })
        .click();
      await expect(hud).toContainText("Tap 12× to start construction time");
      const fastSpeed = page.getByRole("button", {
        name: "fast speed",
        exact: true,
      });
      await expect(fastSpeed).toHaveClass(/tutorialTarget/);
      await fastSpeed.click();
      await expect(hud).toContainText("Read the year progress bar");
      await expect(progress).toHaveClass(/tutorialTarget/);
      const ring = page.locator(".tutorialTargetRing");
      await expect(ring).toBeVisible();
      await expect(ring).toHaveCSS("animation-name", "none");
      expect(
        await ring.evaluate(
          (element) => getComputedStyle(element, "::before").display,
        ),
      ).toBe("none");
      await expect(progress).not.toHaveAttribute("aria-valuenow", "0");
      expect((await progress.boundingBox())!.width).toBe(initialBox!.width);
      // Seek the animation timeline to prove both glows repeat without waiting eight seconds.
      const next = hud.getByRole("button", { name: "Next", exact: true });
      await expect(next).toHaveAccessibleDescription(
        "Select Next when you’re ready.",
      );
      const cue = next.locator(".tutorialHudNextPulse");
      await expect(cue).toHaveCSS("animation-delay", "0s, 4s");
      const reminders = await cue.evaluate((element) => {
        const animation = element
          .getAnimations()
          .find(
            (candidate) =>
              candidate instanceof CSSAnimation &&
              candidate.animationName === "tutorialNextPulse",
          )!;
        animation.pause();
        return [4000, 4320, 4640, 4960, 8320].map((time) => {
          animation.currentTime = time;
          const transform = getComputedStyle(element).transform;
          return transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
        });
      });
      expect(reminders[0]).toBe(reminders[2]);
      expect(reminders[1]).not.toBe(reminders[0]);
      expect(reminders[3]).toBe(reminders[1]);
      expect(reminders[4]).toBe(reminders[1]);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(cue).toHaveCSS("animation-name", "none");
      await expect(hud.locator(".tutorialHudContinue")).toBeVisible();
      await expect(next).toHaveClass(/MuiButton-contained/);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toBeHidden();
      if (process.env.REVIEW_SCREENSHOT_DIR) {
        await expect(page.locator(".MuiSnackbar-root")).toBeHidden();
      }
      await reviewScreenshot(page, {
        path: testInfo.outputPath("manual-next.png"),
        animations: "disabled",
      });
      await hud.getByRole("button", { name: "Next" }).click();
      await expect(hud).toContainText(
        "Order a second generator of a different type",
      );
      await expect(progress).not.toHaveClass(/tutorialTarget/);
      await expect(hud.locator(".tutorialHudContinue")).toHaveCount(0);
      await expect(hud.locator(".tutorialHudNextPulse")).toHaveCount(0);
      await expect(
        hud.getByRole("button", { name: "Next", exact: true }),
      ).toHaveCount(0);
    }
    if (mission === "Storage") {
      await hud.getByRole("button", { name: "Next", exact: true }).click();
      await expect(hud).toContainText("Check generation comes before storage");
      await hud.getByRole("button", { name: "Next", exact: true }).click();
      const start = hud.getByRole("button", {
        name: "Start final challenge",
        exact: true,
      });
      await expect(start).toHaveAccessibleDescription(
        "Select Start final challenge when you’re ready.",
      );
      await expect(start.locator(".tutorialHudNextPulse")).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toBeHidden();
      if (process.env.REVIEW_SCREENSHOT_DIR) {
        await expect(page.locator(".MuiSnackbar-root")).toBeHidden();
      }
      await reviewScreenshot(page, {
        path: testInfo.outputPath("manual-challenge.png"),
        animations: "disabled",
      });
      await start.click();
      await expect(hud).toContainText(
        "Supply the evening peak with stored energy",
      );
      await expect(hud.locator(".tutorialHudContinue")).toHaveCount(0);
    }
  });
}
