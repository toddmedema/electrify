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
      name: "Trade",
      exact: true,
    });
    await openPane(
      agreements,
      page.getByRole("button", { name: "Trade", exact: true }),
    );
    let line = agreements.locator(".territoryAgreements");
    await expect(
      line.getByRole("heading", { name: "You", exact: true }),
    ).toHaveCount(0);
    await expect(
      line.getByRole("heading", { name: "Regional nuclear" }),
    ).toBeVisible();
    await expect(
      agreements.getByRole("heading", { name: "Supply trades" }),
    ).toHaveCount(0);
    const inherited = line.getByRole("article", { name: "Regional nuclear" });
    await expect(inherited.getByText("95MW", { exact: true })).toBeVisible();
    await expect(inherited.getByText("Max supply")).toBeVisible();
    await expect(
      inherited.getByRole("row", { name: /^Min payment/ }),
    ).toContainText("Paid even if unused");
    await expect(
      inherited.getByRole("row", { name: /^Final month/ }),
    ).toContainText("Dec 2019");
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
      await agreements
        .locator(".territoryWorkspace")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
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
      page.getByRole("button", { name: "Trade", exact: true }),
    );
    line = agreements.locator(".territoryAgreements");
    await expect(
      inherited.getByText("Inherited", { exact: true }),
    ).toBeVisible();
    await expect(line).toContainText("Dec 2019");
    await expect(line).toContainText("114MW → 57MW on 1 Jan 2020");
    const review = line.getByRole("button", {
      name: "Review Québec hydro replacement",
      exact: true,
    });
    await expect(review).toBeVisible();
    const offer = line.getByRole("button", {
      name: "Review Valley Electric supply trade",
      exact: true,
    });
    await expect(offer).toHaveText("Review");
    await expect(offer.locator('[data-concept="buy"]')).toBeVisible();
    await line.scrollIntoViewIfNeeded();
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`ppa-workspace-${theme}.png`),
      animations: "disabled",
      scale: "css",
    });
    await reviewScreenshot(agreements, {
      path: testInfo.outputPath(`ppa-agreements-${theme}.png`),
      animations: "disabled",
    });
    const newSupply = line.getByRole("article", {
      name: "Valley Electric supply",
      exact: true,
    });
    await newSupply.scrollIntoViewIfNeeded();
    await reviewScreenshot(newSupply, {
      path: testInfo.outputPath(`ppa-offer-${theme}.png`),
      animations: "disabled",
    });
    await review.click();
    const dialog = page.getByRole("dialog", {
      name: "Review Québec hydro replacement",
      exact: true,
    });
    await expectDialogToFit(dialog);
    await expect(dialog).not.toContainText("Delivery and emissions follow");
    await expect(dialog).not.toContainText("2005 dollars");
    await expect(dialog).not.toContainText(
      "Local generation can reduce purchases",
    );
    const table = dialog.getByRole("table", {
      name: "Replacement trade terms",
    });
    await expect(table.getByRole("rowheader")).toHaveText([
      "Trade price",
      "Reference price",
      "Discount",
      "Min payment",
      "Maximum supply",
      "Duration",
      "Final month",
      "Forecasted cash impact",
      "Forecasted grid impact",
    ]);
    await expect(
      dialog.getByRole("row", { name: /Min payment/ }),
    ).toContainText("MWh/month");
    await expect(
      dialog.getByRole("row", { name: /Min payment/ }),
    ).toContainText("Paid even if unused");
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
        (await dialog.getByRole("row", { name: /Trade price/ }).innerText())
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
      "1 year",
    );
    await expect(
      dialog.getByRole("row", { name: /^Final month/ }),
    ).toContainText("Dec 2020");
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
      "5 years",
    );
    expect(await agreementRate()).toBeGreaterThan(tenYearRate);
    expect(await agreementRate()).toBeLessThan(oneYearRate);
    const savings = dialog.getByRole("row", { name: /Forecasted cash impact/ });
    await expect(savings).toContainText(/-?\$[\d.,]+[kMBT]? over 5 years/, {
      timeout: 45000,
    });
    await expect(savings).toContainText("Compared with omitting this trade");
    const impactLabel = dialog.getByRole("rowheader", {
      name: "Forecasted grid impact",
    });
    const impact = dialog.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: "Forecasted grid impact" }),
    });
    const comparison = impact.locator(".powerAgreementGridImpact");
    await expect(comparison).toContainText(/\d+ → \d+%/);
    await impact.scrollIntoViewIfNeeded();
    expect(
      await impactLabel.evaluate((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return range.getClientRects().length;
      }),
    ).toBe(1);

    const thumb = dialog.locator(".MuiSlider-thumb");
    await thumb.scrollIntoViewIfNeeded();
    const thumbBox = (await thumb.boundingBox())!;
    const railBox = (await dialog.locator(".MuiSlider-rail").boundingBox())!;
    const x = thumbBox.x + thumbBox.width / 2;
    const y = thumbBox.y + thumbBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + railBox.width / 3, y);
    await expect(slider).toHaveAttribute("aria-valuenow", "8");
    await expect(impact.getByRole("cell")).toHaveText("—");
    await page.mouse.move(x, y);
    await page.mouse.up();
    await expect(slider).toHaveAttribute("aria-valuenow", "5");
    await expect(comparison).toContainText(/\d+ → \d+%/);
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
      "5 years",
    );
    const accept = dialog.getByRole("button", {
      name: "Accept trade",
      exact: true,
    });
    await accept.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(line).toContainText("Scheduled · starts 1 Jan 2020");
    await expect(line).toContainText("Dec 2024");
    await expect(review).toHaveCount(0);
    const signedAgreement = line
      .locator(".powerAgreement")
      .filter({ hasText: "Scheduled · starts 1 Jan 2020" });
    const confirmation = page.locator(".snackbarContent");
    await expect(confirmation).toContainText("Trade accepted");
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
    const details = signedAgreement.getByRole("table", {
      name: "Trade details",
    });
    await expect(
      details.getByRole("row", { name: /^First month/ }),
    ).toContainText("Jan 2020");
    await expect(
      details.getByRole("row", { name: /^Max monthly supply/ }),
    ).toContainText("MWh/month");
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
      page.getByRole("button", { name: "Trade", exact: true }),
    );
    await expect(line).toContainText("Scheduled · starts 1 Jan 2020");
    await expect(line).toContainText("Dec 2024");
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
      page.getByRole("button", { name: "Trade", exact: true }),
    );
    const expired = line.getByRole("article", { name: "Regional nuclear" });
    await expect(expired).toContainText("Expired 1 Jan 2020");
    await expect(expired.getByText("Max supply")).toHaveCount(0);
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
      history.getByRole("table", { name: "Recorded trade history" }),
    ).toContainText("0 MWh used");
    await expectDialogToFit(history);
    await page.keyboard.press("Escape");
    await expect(history).toHaveCount(0);
    expect((await readSavedGame(page))!.transmission!.lines).toEqual([]);
  });
}
