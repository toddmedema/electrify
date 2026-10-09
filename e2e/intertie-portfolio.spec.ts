import { expectContinuousDialogSurface } from "./dialog-surface";
import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { readSavedGame } from "./save-fixture";

for (const theme of ["light", "dark"] as const) {
  test(`intertie purchase keeps forecasts in build details in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const facilities = page.locator(".facilities:visible");
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await facilities
      .getByRole("button", { name: "Build", exact: true })
      .click();
    await page.getByRole("tab", { name: "Interties", exact: true }).click();
    const review = page.getByRole("button", {
      name: "Review purchase of Pacific Northwest intertie",
    });
    const card = page.locator(".transmissionProject").filter({ has: review });
    await expect(card).toContainText("$1.8M");
    await expect(card).not.toContainText("Portfolio outlook");
    await card
      .getByRole("button", { name: "Show Pacific Northwest details" })
      .click();
    await expect(card).not.toContainText("Portfolio outlook");
    await expect(card).not.toContainText("Added shortfall coverage");
    await expect(card).not.toContainText("Largest remaining shortfall");
    await expect(card).not.toContainText("Gap with half the spare supply");
    await expect(card.locator(".MuiCollapse-root")).toHaveClass(
      /MuiCollapse-entered/,
    );
    const chart = card.locator(".intertieAvailability");
    const details = card.locator(".intertieDetailMetrics");
    await expect(details.locator(".buildOptionMetric")).toHaveCount(3);
    await expect(card).not.toContainText("Purchase cost change / year");
    await expect(card).not.toContainText("If open with your current fleet");
    const chartBox = (await chart.boundingBox())!;
    const detailBox = (await details.boundingBox())!;
    expect(chartBox.y + chartBox.height).toBeLessThanOrEqual(detailBox.y);
    expect(chartBox.width).toBeGreaterThan(
      (await card.boundingBox())!.width * 0.85,
    );
    expect(
      (await chart.locator("svg").boundingBox())!.height,
    ).toBeGreaterThanOrEqual(64);
    // Every wrapped metric row fills the card rather than reserving empty grid cells.
    for (const strip of [card.locator(".buildOptionMetrics"), details]) {
      const rowEnds = await strip
        .locator(":scope > .buildOptionMetric")
        .evaluateAll((cells) => {
          const rows = new Map<number, number>();
          for (const cell of cells) {
            const box = cell.getBoundingClientRect();
            rows.set(
              Math.round(box.y),
              Math.max(rows.get(Math.round(box.y)) || 0, box.right),
            );
          }
          return [...rows.values()];
        });
      const stripBox = (await strip.boundingBox())!;
      expect(
        rowEnds.every(
          (right) => Math.abs(right - (stripBox.x + stripBox.width - 12)) < 2,
        ),
      ).toBe(true);
    }
    expect(
      await card.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `intertie-details-${theme}-${testInfo.project.name}.png`,
        ),
        animations: "disabled",
      });
    }
    // Freeze the quote before checking its exact cash delta; navigation may have
    // allowed a tick before the catalog opened.
    await page.getByRole("button", { name: "pause", exact: true }).click();
    const game = (await readSavedGame(page))!;
    const cash = game.timeline.find(
      (tick) => tick.minute === game.date.minute,
    )!.cash;
    await expect(
      card.locator(".intertieCapacityMetrics > .buildOptionMetric"),
    ).toHaveCount(2);
    await review.click();
    const dialog = page.getByRole("dialog");
    await expectContinuousDialogSurface(dialog);
    await expect(dialog).not.toContainText("Portfolio outlook");
    await expect(dialog).not.toContainText("Shortfall covered");
    await expect(dialog).toContainText("Ready in 12 months.");
    await expect(dialog).not.toContainText("Line capacity");
    await expect(dialog).toContainText(/Import capacity\s*4MW/);
    await expect(dialog).toContainText(/Export capacity\s*5MW/);
    const cashFact = dialog
      .locator(".decisionImpactFact")
      .filter({ hasText: "Cash purchase" });
    const quoted = (await cashFact.innerText()).match(
      /\$([\d.]+)M → \$([\d.]+)M/,
    );
    expect(quoted).not.toBeNull();
    // This scenario's balances are quoted in millions, rounded to one decimal.
    expect(Number(quoted![1])).toBeCloseTo(cash / 1_000_000, 1);
    expect(Number(quoted![2])).toBeCloseTo((cash - 1_800_000) / 1_000_000, 1);
    await expect(dialog).toContainText("Payments start now");
    await expect(dialog).toContainText("$2.88k/mo");
    // Every purchase fact fits alongside both actions on desktop and a 390px phone.
    for (const fact of await dialog.locator(".decisionImpactFact").all()) {
      await expect(fact).toBeInViewport();
    }
    await expect(dialog).not.toContainText(/NaN|Infinity/);
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    for (const button of await dialog
      .locator(".MuiDialogActions-root button")
      .all()) {
      await expect(button).toBeInViewport();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
    }
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      ((theme === "light" && testInfo.project.name === "desktop-chromium") ||
        (theme === "dark" && testInfo.project.name === "mobile-390px"))
    ) {
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `intertie-portfolio-${testInfo.project.name}.png`,
        ),
        animations: "disabled",
      });
    }
    await dialog.getByRole("button", { name: "close", exact: true }).click();
    // The slower southern project still opens within this five-year mission.
    await page
      .getByRole("button", {
        name: "Review purchase of Desert Southwest intertie",
      })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Ready in 36 months");
    await expect(page.getByRole("dialog")).not.toContainText(
      "Won’t open before this mission ends",
    );
  });
}
