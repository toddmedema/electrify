import type { Page } from "@playwright/test";
import { expectDialogToFit } from "./dialog-layout";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { reviewScreenshot } from "./review-screenshot";
import { editSavedGame, readSavedGame } from "./save-fixture";

const quantifiedMargin =
  /[-−+]?[\d.]+\s?[kMGT]?W\s*→\s*[-−+]?[\d.]+\s?[kMGT]?W/;

async function openCoalDetails(page: Page) {
  const fleet = page.locator(".facilities:visible");
  await openPane(
    fleet,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  const coal = fleet.getByRole("button", {
    name: "Inspect Coal",
    exact: true,
  });
  await coal.click();
  return { fleet, coal };
}

for (const theme of ["light", "dark"]) {
  test(`coal repowering reviews cash and loan terms and can be canceled in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Beginner", exact: true }).click();
    await page.getByRole("button", { name: "Start game", exact: true }).click();

    const { fleet, coal } = await openCoalDetails(page);
    const repowering = fleet.getByRole("region", { name: "Coal repowering" });
    const cc = repowering.getByRole("button", {
      name: /^Convert to Natural Gas CC/,
    });
    const peaker = repowering.getByRole("button", {
      name: /^Convert to Natural Gas Peaker/,
    });
    await expect(cc).toBeEnabled();
    await expect(peaker).toBeEnabled();
    await reviewScreenshot(repowering, {
      path: info.outputPath(`coal-actions-${theme}.png`),
      animations: "disabled",
    });

    const dialog = page.getByRole("dialog");
    if (info.project.name === "desktop-chromium") {
      await coal.click({ button: "right" });
      const actions = page.getByRole("menu", { name: "Facility actions" });
      await expect(
        actions.getByRole("menuitem", {
          name: /^Convert to Natural Gas Peaker/,
        }),
      ).toBeEnabled();
      await actions
        .getByRole("menuitem", { name: /^Convert to Natural Gas CC/ })
        .click();
    } else {
      await cc.click();
    }
    await expect(dialog).toHaveAccessibleName("Convert to Natural Gas CC?");
    await expect(dialog).toContainText("90 min");
    await expect(dialog).toContainText("7.2 months");
    await expect(dialog).toContainText("Coal can keep running");
    const facts = dialog.locator(".decisionImpactFact");
    await expect(facts.filter({ hasText: "Rated capacity" })).toHaveCount(0);
    await expect(facts.filter({ hasText: "Cash option" })).toContainText(
      /\$[\d.]+M now/,
    );
    await expect(facts.filter({ hasText: "Loan option" })).toContainText(
      /\$[\d.]+M now \+ \$[\d.]+[kM]\/mo/,
    );
    const payCash = dialog.getByRole("button", { name: "Pay cash" });
    const takeLoan = dialog.getByRole("button", { name: "Take loan" });
    await expect(payCash).toBeEnabled();
    await expect(takeLoan).toBeEnabled();
    const margin = facts.filter({ hasText: "Lowest supply margin" });
    await expect(margin).toContainText(quantifiedMargin, {
      timeout: 20_000,
    });
    await expectDialogToFit(dialog);
    await reviewScreenshot(dialog, {
      path: info.outputPath(`combined-cycle-preview-${theme}.png`),
      animations: "disabled",
    });
    await payCash.click();
    await expect(dialog).toBeHidden();
    await expect(repowering).toContainText("Natural Gas CC");
    const cancelConversion = fleet.getByRole("button", {
      name: "Cancel conversion of Coal",
      exact: true,
    });
    await cancelConversion.click();

    await peaker.click();
    await expect(dialog).toHaveAccessibleName("Convert to Natural Gas Peaker?");
    await expect(dialog).toContainText("10 min");
    await expect(dialog).toContainText("3.6 months");
    await expect(margin).toContainText(quantifiedMargin, {
      timeout: 20_000,
    });
    await expectDialogToFit(dialog);
    await reviewScreenshot(dialog, {
      path: info.outputPath(`peaker-preview-${theme}.png`),
      animations: "disabled",
    });
    await takeLoan.click();
    await expect(dialog).toBeHidden();
    await expect(repowering).toContainText("Natural Gas Peaker");
    await expect(repowering).toContainText("complete");
    await expect(coal).toHaveAccessibleDescription(
      /Natural Gas Peaker, \d+% complete/,
    );
    await expect(
      repowering.getByRole("button", { name: /^Convert to/ }),
    ).toHaveCount(0);
    await expect(
      fleet.getByRole("button", { name: "Pause Coal", exact: true }),
    ).toBeEnabled();
    const sell = fleet.getByRole("button", { name: "Sell Coal", exact: true });
    await expect(sell).toHaveCount(0);
    await reviewScreenshot(
      fleet.locator('.facilityRow[data-facility="Coal"] .facilityActions'),
      {
        path: info.outputPath(`conversion-controls-${theme}.png`),
        animations: "disabled",
      },
    );
    await cancelConversion.click();
    await expect(peaker).toBeEnabled();
    await expect(cc).toBeEnabled();
    await expect(sell).toBeEnabled();
    await expect(coal).toBeFocused();
  });
}

test("both coal review entry points support a down payment without full cash", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "desktop-chromium",
    "Right-click entry point",
  );
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Beginner", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect
    .poll(async () => (await readSavedGame(page))?.scenarioId)
    .toBe(100);
  await editSavedGame(page, ({ game }) => {
    for (const tick of game.timeline) tick.cash = 60_000_000;
  });
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#menuCard")).toBeHidden();

  const { fleet, coal } = await openCoalDetails(page);
  const repowering = fleet.getByRole("region", { name: "Coal repowering" });
  const dialog = page.getByRole("dialog");
  const payCash = dialog.getByRole("button", { name: "Pay cash" });
  const takeLoan = dialog.getByRole("button", { name: "Take loan" });
  await repowering
    .getByRole("button", { name: /^Convert to Natural Gas CC/ })
    .click();
  await expect(payCash).toBeDisabled();
  await expect(takeLoan).toBeEnabled();
  await dialog.getByRole("button", { name: "close", exact: true }).click();

  await coal.click({ button: "right" });
  await page
    .getByRole("menu", { name: "Facility actions" })
    .getByRole("menuitem", { name: /^Convert to Natural Gas CC/ })
    .click();
  await expect(payCash).toBeDisabled();
  await expect(takeLoan).toBeEnabled();
  await takeLoan.click();
  await expect(repowering).toContainText("Natural Gas CC");
  await expect(payCash).toBeHidden();
});
