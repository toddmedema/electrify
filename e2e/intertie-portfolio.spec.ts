import { expectContinuousDialogSurface } from "./dialog-surface";
import path from "path";
import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

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
    await expect(card).toContainText("Portfolio outlook");
    await expect(card).toContainText("Shortfall covered");
    await expect(card).toContainText("Gap with half the spare supply");
    // Freeze the quote before checking its exact cash delta; navigation may have
    // allowed a tick before the catalog opened.
    await page.getByRole("button", { name: "pause", exact: true }).click();
    const cash = await page.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
      const { game } = JSON.parse(localStorage.getItem("savedGame")!);
      return game.timeline.find(
        (tick: { minute: number }) => tick.minute === game.date.minute,
      ).cash as number;
    });
    await review.click();
    const dialog = page.getByRole("dialog");
    await expectContinuousDialogSurface(dialog);
    await expect(dialog).not.toContainText("Portfolio outlook");
    await expect(dialog).not.toContainText("Shortfall covered");
    await expect(dialog).toContainText("5MW access · Ready in 12 months");
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
    await expect(dialog).toContainText("$3k/mo");
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
    // A three-year southern project cannot rescue this scenario's year-two fire emergency.
    await page
      .getByRole("button", {
        name: "Review purchase of Desert Southwest intertie",
      })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Won’t open before this mission ends",
    );
  });
}
