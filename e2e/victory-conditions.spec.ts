import path from "path";
import { expect, test } from "./fixtures";
import { expectDialogToFit } from "./dialog-layout";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  for (const scenario of [
    { id: 113, name: "Load Shedding", window: "2022" },
    { id: 110, name: "Sudden Nuclear Shutdown", window: "Jul 2026–Dec 2027" },
    { id: 100, name: "Carbon Fee" },
  ]) {
    test(`${scenario.name} victory requirements stay readable in ${theme} mode`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript((mode) => {
        localStorage.clear();
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
      }, theme);
      await page.goto(`/?scenario=${scenario.id}`);
      {
        await page
          .getByRole("button", { name: "Goals", exact: true })
          .click();
        const briefing = page.getByRole("dialog");
        await expect(briefing.locator("..")).toHaveCSS("opacity", "1");
        const requirements = briefing.getByRole("region", {
          name: "Requirements",
        });
        const scoring = briefing.getByRole("region", { name: "Scoring" });
        await expect(requirements).toBeVisible();
        await expect(
          scoring.getByText("Service", { exact: true }),
        ).toBeVisible();
        await expect(scoring).toContainText("Financial performance");
        await expect(scoring).toContainText("Environmental impact");
        await expect(requirements).not.toContainText("points");
        if (scenario.id === 100) {
          await expect(requirements).toContainText(
            "Keep ≥80% of starting customers",
          );
        }
        const help = briefing.locator("details");
        await expect(help).not.toHaveAttribute("open", "");
        await help.locator("summary").click();
        await expect(help).toHaveAttribute("open", "");
        await help.locator("summary").click();
        await expect(briefing).not.toContainText("build or upgrade the grid");
        await expectDialogToFit(briefing);
        if (process.env.REVIEW_SCREENSHOT_DIR && scenario.id === 100) {
          await briefing
            .locator(".MuiDialogContent-root")
            .evaluate((content) => {
              content.scrollTop = 0;
            });
          await page.mouse.move(0, 0);
          await briefing.screenshot({
            path: path.join(
              process.env.REVIEW_SCREENSHOT_DIR,
              `requirements-${testInfo.project.name}-${theme}.png`,
            ),
          });
        }
        await briefing
          .getByRole("button", { name: "Close", exact: true })
          .click();
      }
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const dialog = page.getByRole("region", {
        name: "Scenario",
        exact: true,
      });
      await openPane(
        dialog,
        page
          .locator("#navfooter:visible")
          .getByRole("button", { name: "Scenario", exact: true }),
      );
      await dialog.evaluate(async (panel) => {
        await Promise.all(
          panel.getAnimations().map((animation) => animation.finished),
        );
      });
      await expect(dialog).toContainText(scenario.name);
      await expectDialogToFit(dialog);
      const rules = dialog.locator(".missionRequirements dt");
      const rows = await rules.evaluateAll((terms) =>
        terms.map((term) => {
          const descriptions: string[] = [];
          let next = term.nextElementSibling;
          while (next?.tagName === "DD") {
            descriptions.push(next.textContent || "");
            next = next.nextElementSibling;
          }
          return descriptions;
        }),
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const descriptions of rows) {
        expect(descriptions).toHaveLength(1);
        expect(descriptions.join("").trim()).not.toBe("");
      }
      if (scenario.id === 100) {
        await expect(dialog).toContainText(
          "Keep ≥80% of starting customers by Dec 2031",
        );
        await expect(dialog).not.toContainText("Invest in the grid");
      }
      if (scenario.window) {
        const target = `≥99.5% of demand monthly · ${scenario.window}`;
        const requirement = rows.find((descriptions) =>
          descriptions.includes(target),
        );
        expect(requirement).toBeDefined();
        expect(requirement).toEqual([target]);
      }
      await expect(
        dialog.getByRole("region", { name: "Goals" }),
      ).not.toContainText(
        /Not started|Recorded:|months completed|Delivered customer electricity divided/,
      );
      const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
      if (
        reviewDir &&
        scenario.id === 113 &&
        (testInfo.project.name === "desktop-chromium" ||
          (theme === "dark" && testInfo.project.name === "mobile-390px"))
      ) {
        await page.waitForTimeout(400);
        await dialog.screenshot({
          path: path.join(
            reviewDir,
            `victory-conditions-${testInfo.project.name}-${theme}.png`,
          ),
        });
      }
    });
  }
}
