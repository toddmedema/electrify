import { expect, test } from "./fixtures";
import { editSavedGame, readSavedGame } from "./save-fixture";
import { expectDialogToFit } from "./dialog-layout";
import { reviewScreenshot } from "./review-screenshot";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`company supply reviews and retains a signed agreement in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await page.addInitScript((mode) => {
      if (!sessionStorage.getItem("ppa-fixture")) {
        localStorage.clear();
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
        sessionStorage.setItem("ppa-fixture", "1");
      }
    }, theme);
    await page.goto("/?scenario=116");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const agreements = page.getByRole("region", {
      name: "Agreements",
      exact: true,
    });
    await openPane(
      agreements,
      page.getByRole("button", { name: "Agreements", exact: true }),
    );
    let line = agreements.locator(".territoryAgreements");
    await expect(line).toContainText("Regional nuclear · Inherited");
    await expect(
      agreements.getByRole("heading", { name: "Supply agreements" }),
    ).toHaveCount(0);
    await expect(
      agreements.getByRole("heading", { name: "Power purchase agreements" }),
    ).toHaveCount(0);
    const inherited = line.locator(".powerAgreement").filter({
      has: page.getByRole("heading", { name: "Regional nuclear · Inherited" }),
    });
    await expect(inherited.getByText(/Up to 95MW/)).toBeVisible();
    await expect(
      inherited.getByText(/Minimum payment: .*even if unused/),
    ).toBeVisible();
    await expect(inherited.getByText(/Market now/)).toBeHidden();
    await inherited.locator("summary").click();
    await expect(inherited.getByText(/Market now/)).toBeVisible();
    await inherited.locator("summary").click();
    for (const control of await line.locator("button, summary").all()) {
      if (await control.isVisible()) {
        const box = await control.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(
          testInfo.project.name.includes("mobile") ? 44 : 40,
        );
      }
    }
    expect(
      await agreements.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    const opening = await readSavedGame(page);
    expect(opening!.transmission!.lines).toEqual([]);
    await editSavedGame(page, ({ game }) => {
      // A paused continuation fixture enters the authored 24-month offer window. Historic
      // readings remain untouched; the continuation owner recalculates future prices/supply.
      const minute = 156 * 1440;
      const offset = minute - game.date.minute;
      game.date = {
        minute,
        minuteOfDay: 0,
        hourOfDay: 0,
        hourOfFullYear: 720,
        percentOfMonth: 0.00001,
        percentOfYear: 0.00001,
        month: "Jan",
        monthNumber: 1,
        monthsElapsed: 156,
        year: 2018,
      };
      game.speed = "PAUSED";
      game.objectiveProgress = undefined;
      for (const tick of game.timeline) tick.minute += offset;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(
      agreements,
      page.getByRole("button", { name: "Agreements", exact: true }),
    );
    line = agreements.locator(".territoryAgreements");
    await expect(line).toContainText("Regional nuclear · Inherited");
    await expect(line).toContainText("Through 31 Dec 2019");
    await expect(line).toContainText("114MW → 57MW on 1 Jan 2020");
    const review = line.getByRole("button", {
      name: "Review Québec hydro replacement",
      exact: true,
    });
    await expect(review).toBeVisible();
    await line.scrollIntoViewIfNeeded();
    await reviewScreenshot(line, {
      path: testInfo.outputPath(`ppa-agreements-${theme}.png`),
      animations: "disabled",
    });
    await review.click();
    const dialog = page.getByRole("dialog", {
      name: "Review Québec hydro replacement",
      exact: true,
    });
    await expectDialogToFit(dialog);
    await expect(dialog).not.toContainText("2005 dollars");
    await expect(dialog).not.toContainText(
      "Local generation can reduce purchases",
    );
    const table = dialog.getByRole("table", {
      name: "Replacement agreement terms",
    });
    await expect(table.getByRole("rowheader")).toHaveText([
      "Agreement price",
      "Reference price",
      "Discount",
      "Minimum supply",
      "Maximum supply",
      "Duration",
      "Forecasted cash impact",
    ]);
    await expect(
      dialog.getByRole("row", { name: /Minimum supply/ }),
    ).toContainText("MWh/month");
    await expect(
      dialog.getByRole("row", { name: /Minimum supply/ }),
    ).toContainText("Paid for even if you don't use it");
    await expect(
      dialog.getByRole("row", { name: /Maximum supply/ }),
    ).toContainText("57 MW");
    await expect(
      dialog.getByRole("row", { name: /Maximum supply/ }),
    ).toContainText("MWh/month");
    await expect(
      dialog.getByRole("row", { name: /Maximum supply/ }),
    ).not.toContainText("60 MW");
    const agreementRate = async () =>
      Number(
        (await dialog.getByRole("row", { name: /Agreement price/ }).innerText())
          .match(/\$([\d,.]+)\/MWh/)![1]
          .replaceAll(",", ""),
      );
    const marketRate = Number(
      (await dialog.getByRole("row", { name: /Reference price/ }).innerText())
        .match(/\$([\d,.]+)\/MWh/)![1]
        .replaceAll(",", ""),
    );
    const tenYearRate = await agreementRate();
    expect(tenYearRate).toBeLessThan(marketRate);
    const discount = dialog.getByRole("row", { name: /^Discount/ });
    await expect(discount).toHaveText("Discount20%");
    await expect(dialog.getByText(/The price follows inflation/)).toHaveCount(
      0,
    );
    const slider = dialog.getByRole("slider", { name: /^Duration/ });
    await expect(slider).toHaveAttribute("min", "1");
    await expect(slider).toHaveAttribute("max", "10");
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuenow", "1");
    await expect(dialog.getByRole("row", { name: /Duration/ })).toContainText(
      "1 yearEnds Dec 2020",
    );
    const oneYearRate = await agreementRate();
    await expect(discount).toHaveText("Discount1%");
    expect(oneYearRate).toBeGreaterThan(tenYearRate);
    expect(oneYearRate).toBeLessThan(marketRate);
    await page.keyboard.press("End");
    await expect(slider).toHaveAttribute("aria-valuenow", "10");
    expect(await agreementRate()).toBe(tenYearRate);
    await expect(discount).toHaveText("Discount20%");
    await page.keyboard.press("Home");
    for (let year = 1; year < 5; year++)
      await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "5");
    await expect(slider).toHaveAttribute("aria-valuetext", "5 years");
    await expect(dialog.locator(".powerAgreementDuration")).toHaveText(
      "5 years",
    );
    await expect(discount).toHaveText("Discount9.44%");
    await expect(dialog.getByRole("row", { name: /Duration/ })).toContainText(
      "5 yearsEnds Dec 2024",
    );
    expect(await agreementRate()).toBeGreaterThan(tenYearRate);
    expect(await agreementRate()).toBeLessThan(oneYearRate);
    const savings = dialog.getByRole("row", { name: /Forecasted cash impact/ });
    await expect(savings).toContainText(/-?\$[\d.,]+[kMBT]? over 5 years/, {
      timeout: 45000,
    });
    await expect(savings).toContainText(
      "Compared with omitting this agreement",
    );
    await expect(
      dialog.getByRole("heading", { name: "Demand served" }),
    ).toHaveCount(0);
    await expectDialogToFit(dialog);
    await reviewScreenshot(dialog, {
      path: testInfo.outputPath(`ppa-review-${theme}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(review).toBeFocused();
    expect(
      (await readSavedGame(page))!.transmission!.acceptedAgreements ?? [],
    ).toEqual([]);
    await review.click();
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(review).toBeFocused();
    await review.click();
    await slider.focus();
    await page.keyboard.press("Home");
    for (let year = 1; year < 5; year++)
      await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("row", { name: /Duration/ })).toContainText(
      "5 yearsEnds Dec 2024",
    );
    const accept = dialog.getByRole("button", {
      name: "Accept agreement",
      exact: true,
    });
    await accept.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(line).toContainText("Scheduled · starts 1 Jan 2020");
    await expect(line).toContainText("Through 31 Dec 2024");
    await expect(review).toHaveCount(0);
    const signedAgreement = line
      .locator(".powerAgreement")
      .filter({ hasText: "Scheduled · starts 1 Jan 2020" });
    const confirmation = page.locator(".snackbarContent");
    await expect(confirmation).toContainText("Agreement accepted");
    const dismiss = confirmation.getByRole("button", {
      name: "Dismiss notification",
    });
    if (await dismiss.isVisible()) {
      await dismiss.click();
    } else {
      // Phones use the existing swipe-to-dismiss action rather than a close button.
      await confirmation.click({ trial: true });
      const box = (await confirmation.boundingBox())!;
      await page.mouse.move(box.x + 24, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 184, box.y + box.height / 2, { steps: 8 });
      await page.mouse.up();
    }
    await expect(page.locator(".MuiSnackbar-root")).toHaveCount(0);
    await signedAgreement.scrollIntoViewIfNeeded();
    await expect(signedAgreement).toBeInViewport();
    await reviewScreenshot(signedAgreement, {
      path: testInfo.outputPath(`ppa-signed-${theme}.png`),
      animations: "disabled",
    });
    await signedAgreement.locator("summary").click();
    await expect(signedAgreement).toContainText("1 Jan 2020–31 Dec 2024");
    await signedAgreement
      .getByRole("button", { name: /^Forecast .* remaining term$/ })
      .click();
    const remaining = page.getByRole("dialog", {
      name: "Québec hydro remaining term",
      exact: true,
    });
    await expect(remaining.getByRole("slider")).toHaveCount(0);
    await expect(
      remaining.getByRole("row", { name: /Forecasted cash impact/ }),
    ).toContainText(/-?\$[\d.,]+[kMBT]? over 5 years remaining/, {
      timeout: 45000,
    });
    await expect(
      remaining.getByRole("row", { name: /Duration/ }),
    ).toContainText("5 yearsEnds Dec 2024");
    await expect(
      remaining.getByRole("row", { name: /Minimum supply/ }),
    ).toContainText("MWh/month");
    await expectDialogToFit(remaining);
    await reviewScreenshot(remaining, {
      path: testInfo.outputPath(`ppa-remaining-${theme}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(remaining).toHaveCount(0);
    const signed = await readSavedGame(page);
    expect(signed!.transmission!.acceptedAgreements).toHaveLength(1);
    expect(signed!.transmission!.acceptedAgreements![0]).toMatchObject({
      termsVersion: 3,
      durationYears: 5,
      startMinute: 180 * 1440,
      endMinute: 240 * 1440,
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(
      agreements,
      page.getByRole("button", { name: "Agreements", exact: true }),
    );
    await expect(line).toContainText("Scheduled · starts 1 Jan 2020");
    await expect(line).toContainText("Through 31 Dec 2024");
    expect(
      (await readSavedGame(page))!.transmission!.acceptedAgreements,
    ).toEqual(signed!.transmission!.acceptedAgreements);
    await editSavedGame(page, ({ game }) => {
      const offset = 180 * 1440 - game.date.minute;
      game.date.minute += offset;
      game.date.monthsElapsed = 180;
      game.date.year = 2020;
      // The paused date jump records no accounting. Retain one valid, unused
      // month so this journey also verifies the archived-history action.
      game.transmission!.agreementAccounts = [
        {
          agreementId: "champlain-nuclear",
          termsVersion: 3,
          accountingStartMinute: 179 * 1440,
          accountedThroughMinute: 180 * 1440,
          months: [
            {
              month: 179,
              availableMWh: 0,
              usefulMWh: 0,
              availableValue: 0,
              usefulValue: 0,
              payment: 0,
            },
          ],
        },
      ];
      game.objectiveProgress = undefined;
      for (const tick of game.timeline) tick.minute += offset;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(
      agreements,
      page.getByRole("button", { name: "Agreements", exact: true }),
    );
    await expect(line).toContainText("Regional nuclear · Expired 1 Jan 2020");
    const expired = line.locator(".powerAgreement").filter({
      has: page.getByRole("heading", {
        name: "Regional nuclear · Expired 1 Jan 2020",
      }),
    });
    await expect(expired.getByText(/Up to/)).toHaveCount(0);
    await expect(
      expired.getByRole("button", {
        name: "Regional nuclear recorded history",
      }),
    ).toBeVisible();
    await expired
      .getByRole("button", { name: "Regional nuclear recorded history" })
      .click();
    const history = page.getByRole("dialog", {
      name: "Regional nuclear recorded history",
    });
    await expect(
      history.getByRole("table", { name: "Recorded agreement history" }),
    ).toContainText("0 MWh used");
    await expectDialogToFit(history);
    await page.keyboard.press("Escape");
    await expect(history).toHaveCount(0);
    expect((await readSavedGame(page))!.transmission!.lines).toEqual([]);
  });
}
