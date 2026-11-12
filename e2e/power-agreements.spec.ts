import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { editSavedGame, readSavedGame } from "./save-fixture";
import { expectDialogToFit } from "./dialog-layout";
import { reviewScreenshot } from "./review-screenshot";

for (const theme of ["light", "dark"] as const) {
  test(`inherited connection reviews and retains a signed agreement in ${theme}`, async ({
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
    const facilities = page.locator(".facilities:visible");
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    let line = facilities
      .locator(".transmissionLine")
      .filter({ hasText: "Champlain regional connection" });
    await expect(line).toContainText("209MW under agreement");
    await expect(
      line.getByRole("button", { name: /^Review upgrade/ }),
    ).toHaveCount(0);
    const opening = await readSavedGame(page);
    expect(
      opening!.transmission!.lines.find(
        (entry) => entry.corridorId === "vt-champlain-regional",
      ),
    ).toMatchObject({ capacityW: 300e6, buildCost: 0, yearsToBuildLeft: 0 });
    const openingInspect = line.getByRole("button", {
      name: /^Inspect Champlain regional connection/,
    });
    await openingInspect.click();
    await expect(
      line.getByText("Market price now", { exact: true }),
    ).toBeVisible();
    await expect(
      line.getByText("Market emissions (CO₂e)", { exact: true }),
    ).toBeVisible();
    const marketBuying = facilities.getByRole("combobox", {
      name: "Market buying",
      exact: true,
    });
    await marketBuying.click();
    await page.getByRole("option", { name: "None", exact: true }).click();
    await expect(line).toContainText(
      "Market buying is off. Existing agreements continue.",
    );
    await expect(line).not.toContainText("Flow limited by: Trading rule");
    const contractedOnly = await readSavedGame(page);
    const current = contractedOnly!.timeline.find(
      (tick) => tick.minute === contractedOnly!.date.minute,
    )!;
    expect(current.importedW).toBeGreaterThan(0);
    expect(current.importedW).toBe(current.entitlementImportedW);
    await marketBuying.click();
    await page
      .getByRole("option", { name: "Shortages only", exact: true })
      .click();
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
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    line = facilities
      .locator(".transmissionLine")
      .filter({ hasText: "Champlain regional connection" });
    const inspect = line.getByRole("button", {
      name: /^Inspect Champlain regional connection/,
    });
    await inspect.click();
    await expect(inspect).toHaveAttribute("aria-expanded", "true");
    await expect(line).toContainText("Power purchase agreements");
    await expect(line).toContainText("Regional nuclear · Inherited");
    await expect(line).toContainText("Through 31 Dec 2019");
    await expect(line).toContainText("114MW → 57MW on 1 Jan 2020");
    const summary = line.locator(".powerAgreementSummary");
    await expect(summary).toContainText("Replacement available");
    expect(
      await line
        .locator(".facilityStatus")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    expect(
      await summary.evaluate((element) => getComputedStyle(element).whiteSpace),
    ).toBe("normal");
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
    const header = line.locator(".facilityRowHeader");
    await header.scrollIntoViewIfNeeded();
    const headerBounds = (await header.boundingBox())!;
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`ppa-connection-${theme}.png`),
      animations: "disabled",
      clip: { ...headerBounds, width: Math.min(560, headerBounds.width) },
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
    const marketNow = await line
      .locator(".facilityStat")
      .filter({ hasText: "Market price now" })
      .locator("dd")
      .innerText();
    await expect(
      dialog.getByRole("row", { name: /Vs market now/ }),
    ).toContainText(marketNow);
    for (const fact of [
      "Coverage57MW",
      "1 Jan 2020–31 Dec 2029",
      "Follows inflation",
      "$0 upfront · pay for delivered energy",
      "No minimum purchase",
    ])
      await expect(dialog).toContainText(fact);
    await expect(
      dialog.getByRole("button", { name: "Accept agreement", exact: true }),
    ).toBeVisible();
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
    const accept = dialog.getByRole("button", {
      name: "Accept agreement",
      exact: true,
    });
    await accept.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(line).toContainText("Scheduled · starts 1 Jan 2020");
    await expect(line).toContainText("1 Jan 2020–31 Dec 2029");
    await expect(inspect).toBeFocused();
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
    const signed = await readSavedGame(page);
    expect(signed!.transmission!.acceptedAgreements).toHaveLength(1);
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await inspect.click();
    await expect(line).toContainText("Scheduled · starts 1 Jan 2020");
    expect(
      (await readSavedGame(page))!.transmission!.acceptedAgreements,
    ).toEqual(signed!.transmission!.acceptedAgreements);
    await editSavedGame(page, ({ game }) => {
      const offset = 180 * 1440 - game.date.minute;
      game.date.minute += offset;
      game.date.monthsElapsed = 180;
      game.date.year = 2020;
      game.objectiveProgress = undefined;
      for (const tick of game.timeline) tick.minute += offset;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await inspect.click();
    await expect(line).toContainText("Regional nuclear · Expired 1 Jan 2020");
    await expect(line).toContainText(
      "Uncovered purchases use regional market prices and availability",
    );
    await expect(
      line.getByRole("button", {
        name: "Pause Champlain regional connection",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await readSavedGame(page))!.transmission!.lines.find(
        (entry) => entry.corridorId === "vt-champlain-regional",
      )!.capacityW,
    ).toBe(300e6);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
