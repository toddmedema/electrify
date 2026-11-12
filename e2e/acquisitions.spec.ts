import path from "path";
import { expect, test } from "./fixtures";
import { openBuild, openPane } from "./layout";
import { expectPurchaseFactTable } from "./purchase-review-layout";
import { expectDialogToFit } from "./dialog-layout";
import { expectContinuousDialogSurface } from "./dialog-surface";
import { editSavedGame, readSavedGame, readSaveRecords } from "./save-fixture";

for (const theme of ["light", "dark"] as const) {
  test(`completed Tier 1 connections acquire either utility in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((mode) => {
      if (!sessionStorage.getItem("acquisition-fixture")) {
        localStorage.clear();
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
        sessionStorage.setItem("acquisition-fixture", "1");
      }
    }, theme);
    await page.goto("/?scenario=116");
    await expect(
      page.getByRole("heading", { name: "Across the Valley", exact: true }),
    ).toBeVisible();
    // The dossier carries one description; the dated acquisition goal lives behind the labelled
    // goals button rather than in a second paragraph of near-identical copy.
    await expect(page.locator(".scenarioDossier")).toContainText(
      "acquire a utility",
    );
    await page
      .getByRole("button", { name: "Goals and scoring", exact: true })
      .click();
    const goalsDialog = page.getByRole("dialog");
    await expect(
      goalsDialog.getByRole("region", { name: "Requirements" }),
    ).toContainText("Acquire Valley Electric or Ridge Electric · Dec 2014");
    await goalsDialog
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(goalsDialog).toHaveCount(0);
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const facilities = page.locator(".facilities:visible");
    await expect(
      facilities.getByRole("button", {
        name: "Inspect Oil A",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      facilities.getByRole("button", {
        name: "Inspect Oil B",
        exact: true,
      }),
    ).toBeVisible();
    await openBuild(page);
    await page.getByRole("tab", { name: "Generators", exact: true }).click();
    await page.getByRole("slider").first().press("Home");
    await page
      .getByRole("button", { name: "Review purchase of Wind", exact: true })
      .click();
    const buildDialog = page.getByRole("dialog");
    const facilityStyle = await expectPurchaseFactTable(buildDialog, [
      "Cash option",
      "Loan option",
      "Maintenance",
      "Online in",
      "Average output over a year",
      "Direct emissions",
    ]);
    await buildDialog
      .getByRole("button", { name: "close", exact: true })
      .click();
    await openBuild(page);
    await page.getByRole("tab", { name: "Interties", exact: true }).click();
    for (const target of ["Valley Electric", "Ridge Electric"]) {
      await openBuild(page);
      await page.getByRole("tab", { name: "Interties", exact: true }).click();
      await page
        .getByRole("button", { name: `Review ${target} company`, exact: true })
        .click();
      const terms = page.getByRole("dialog", {
        name: `${target} company terms`,
        exact: true,
      });
      await expectDialogToFit(terms);
      for (const text of [
        "Equity price + fee",
        "Assumed debt",
        "Customers joining today",
        "Seller load reference · January 2005",
        "Cash purchase",
        "Financed cash due",
        "Your cash",
        "Debt payments with financing",
        "Debt payments after cash purchase",
        "Operating plants",
        "Purchased power",
        "Scenario obligations",
        "Jan 2020 · Champlain Electric",
        "Jan 2015: 1.5× opening upkeep",
      ])
        await expect(terms).toContainText(text);
      if (target === "Valley Electric")
        await expect(terms).toContainText("Jan 2017");
      await expect(terms).toContainText(
        target === "Valley Electric"
          ? "2.2TWh annual delivered energy · 406MW peak demand"
          : "1TWh annual delivered energy · 160MW peak demand",
      );
      await expect(
        terms.getByRole("button", { name: /Pay cash|Take loan|Acquire / }),
      ).toHaveCount(0);
      const back = terms.getByRole("button", {
        name: "Back to connections",
        exact: true,
      });
      await expect(back).toBeInViewport();
      expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
      await back.click();
      const review = page.getByRole("button", {
        name: new RegExp(`Review purchase of .*${target}`),
      });
      await review.click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Take loan", exact: true })
        .click();
    }
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await expect(
      facilities.getByRole("button", { name: /^Acquire / }),
    ).toHaveCount(0);
    const unfinished = await readSavedGame(page);
    expect(
      unfinished?.transmission?.lines.filter(
        (line) =>
          line.corridorId === "vt-champlain-valley" ||
          line.corridorId === "vt-champlain-ridge",
      ),
    ).toHaveLength(2);
    expect(
      unfinished?.transmission?.lines
        .filter((line) => line.buildCost > 0)
        .every((line) => line.yearsToBuildLeft > 0),
    ).toBe(true);
    await editSavedGame(page, ({ game }) => {
      for (const line of game.transmission!.lines.filter(
        (line) => line.buildCost > 0,
      ))
        line.yearsToBuildLeft = 0;
      // UI fixture: exercise cash as well as financed acquisition without running years of economics.
      for (const tick of game.timeline) tick.cash = 1e9;
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );

    for (const [index, target] of [
      "Valley Electric",
      "Ridge Electric",
    ].entries()) {
      const line = facilities.locator(
        `.transmissionLine[data-corridor-id="vt-champlain-${index === 0 ? "valley" : "ridge"}"]`,
      );
      const acquire = line.getByRole("button", {
        name: `Acquire ${target}`,
        exact: true,
      });
      await expect(acquire).toHaveCount(0);
      const inspect = line.getByRole("button", { name: /^Inspect / });
      await inspect.click();
      await expect(acquire).toBeVisible();
      await expect(line).not.toContainText("Review the company terms");
      const upgrade = line.getByRole("button", { name: /^Review upgrade/ });
      if ((testInfo.project.use.viewport?.width ?? 1280) >= 600) {
        const [acquireBox, upgradeBox] = await Promise.all([
          acquire.boundingBox(),
          upgrade.boundingBox(),
        ]);
        expect(Math.abs(acquireBox!.y - upgradeBox!.y)).toBeLessThanOrEqual(1);
      }
      expect((await acquire.boundingBox())!.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
      await inspect.click();
      await expect(acquire).toHaveCount(0);
      await inspect.click();
      await acquire.click();
      const dialog = page.getByRole("dialog", {
        name: `Acquire ${target}?`,
        exact: true,
      });
      await expect(dialog).toHaveAccessibleName(`Acquire ${target}?`);
      await expectContinuousDialogSurface(dialog);
      await expectDialogToFit(dialog);
      await expect(
        dialog.getByText("Customers", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog
          .locator(".decisionImpactFact")
          .filter({ hasText: /^Supply margin/ })
          .locator(".decisionImpactFactValue"),
      ).toHaveText(/^-?[\d.]+[kMG]?W → [\d.]+[kMG]?W (spare|shortfall)$/);
      await expect(
        dialog.getByRole("region", { name: "Acquisition obligations" }),
      ).toBeVisible();
      await expect(dialog).not.toContainText(
        /Plant operating costs|cash-only transaction fee/,
      );
      await expectPurchaseFactTable(
        dialog,
        ["Cash option", "Loan option", "Customers", "Supply margin"],
        facilityStyle,
      );
      for (const label of ["Cash option", "Loan option"]) {
        const payment = dialog
          .locator(".decisionImpactFact")
          .filter({ hasText: new RegExp(`^${label}`) });
        await expect(payment.locator(".decisionImpactFactValue")).toContainText(
          /now \+ .*\/mo/,
        );
      }
      for (const details of await dialog.locator("details").all())
        await expect(details).not.toHaveAttribute("open");
      const assets = dialog
        .locator("details")
        .filter({ hasText: "Plants & purchased power" });
      await assets.locator("summary").click();
      const plants = assets.getByRole("region", {
        name: "Operating plants",
        exact: true,
      });
      const plantLines = await plants
        .locator(".decisionImpactFactValue")
        .allInnerTexts();
      expect(plantLines).toHaveLength(3);
      const capacities = plantLines.map((text) =>
        Number(text.match(/([\d.]+)MW/)![1]),
      );
      expect(capacities).toEqual([...capacities].sort((a, b) => b - a));
      await expect(
        assets.getByRole("heading", { name: "Purchased power", exact: true }),
      ).toBeVisible();
      if (target === "Valley Electric") {
        await expect(assets).toContainText("114MW delivered");
        await expect(assets).toContainText("Regional nuclear");
        await expect(assets).toContainText("Québec hydro");
        await expect(assets).not.toContainText("New England balancing");
        await expect(assets).toContainText("January 2017");
        await expect(dialog).not.toContainText("Plan replacement supply");
      }
      await assets.locator("summary").click();
      const finance = dialog
        .locator("details")
        .filter({ hasText: "Financing breakdown" });
      await finance.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(finance).toHaveAttribute("open");
      await expectPurchaseFactTable(
        dialog,
        [
          "Purchase price",
          "Transaction fee",
          "Inherited debt",
          "New loan",
          "Added network upkeep",
        ],
        facilityStyle,
        "Financing breakdown",
      );
      await expect(finance).toContainText("5% over 20 years");
      await expect(finance).toContainText("over 30 years");
      await expect(finance).toContainText("Paid in cash with either option");
      await finance.locator("summary").click();
      const schedule = dialog
        .locator("details")
        .filter({ hasText: "Supply & network changes" });
      await schedule.locator("summary").click();
      await expect(schedule).toContainText("Jan 2020");
      await expect(schedule).toContainText("Jan 2015: 1.5× opening upkeep");
      if (target === "Valley Electric")
        await expect(schedule).toContainText("Jan 2017");
      await schedule.locator("summary").click();
      const help = dialog.getByRole("button", {
        name: "What is interest rate?",
        exact: true,
      });
      await help.focus();
      await page.keyboard.press("Enter");
      const manual = page.getByRole("dialog", {
        name: "Manual help",
        exact: true,
      });
      await expect(
        manual.getByRole("heading", {
          name: "Interest rates & inflation",
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(manual).toBeHidden();
      await expect(help).toBeFocused();
      await expect(dialog).toBeVisible();
      const beforeCancel = await readSavedGame(page);
      await dialog.getByRole("button", { name: "close", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const afterCancel = await readSavedGame(page);
      expect(afterCancel?.utilityExpansion).toEqual(
        beforeCancel?.utilityExpansion,
      );
      await acquire.click();
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
        index === 0 &&
        testInfo.project.name !== "mobile-390px" &&
        theme ===
          (testInfo.project.name === "desktop-chromium" ? "light" : "dark")
      ) {
        await dialog.locator(".MuiDialogContent-root").evaluate((element) => {
          element.scrollTop = 0;
        });
        await page.mouse.move(0, 0);
        await dialog.screenshot({
          path: path.join(
            process.env.REVIEW_SCREENSHOT_DIR,
            `acquisition-${testInfo.project.name}-${theme}.png`,
          ),
          animations: "disabled",
        });
      }
      // Enter uses the same semantic button action as keyboard/controller confirmation.
      const purchase = dialog.getByRole("button", {
        name: index === 0 ? "Take loan" : "Pay cash",
        exact: true,
      });
      const beforePurchase = (await readSavedGame(page))!;
      const customersBefore = beforePurchase.timeline
        .filter((tick) => tick.minute <= beforePurchase.date.minute)
        .at(-1)!.customers;
      const customerPreview = await dialog
        .locator(".decisionImpactFact")
        .filter({ hasText: /^Customers/ })
        .locator(".decisionImpactFactValue")
        .textContent();
      await purchase.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(line).toContainText("· Owned");
      await expect(line).toContainText("Acquired utility");
      const afterPurchase = (await readSavedGame(page))!;
      const receipt = afterPurchase.utilityExpansion!.acquisitions.find(
        (entry) =>
          entry.targetId ===
          (index === 0 ? "valley-electric" : "ridge-electric"),
      )!;
      expect(receipt).toBeDefined();
      expect(customerPreview).toBe(
        `${Math.round(customersBefore).toLocaleString("en-US")} → ${Math.round(customersBefore + receipt.transferredCustomers).toLocaleString("en-US")} (+${Math.round((receipt.transferredCustomers / customersBefore) * 100)}%)`,
      );
      const inspectOwned = line.getByRole("button", { name: /^Inspect / });
      if ((await inspectOwned.getAttribute("aria-expanded")) !== "true")
        await inspectOwned.click();
      await expect(line).toContainText("Connection upkeep");
      await expect(
        line.getByRole("button", {
          name: /^Review upgrade|^Pause|^Resume|^Reorder/,
        }),
      ).toHaveCount(0);
      await expect(line).not.toContainText("Transfer capacity");
      const scenario = page.getByRole("region", {
        name: "Scenario",
        exact: true,
      });
      await openPane(
        scenario,
        page.getByRole("button", { name: "Scenario", exact: true }),
      );
      const goals = scenario.locator(".missionRequirements");
      await expect(
        goals.getByText("Retire original oil plants", { exact: true }),
      ).toBeVisible();
      await expect(
        goals.getByText("Acquire a utility", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(goals).toContainText("Champlain’s Oil A by Dec 2020");
      await expect(goals).toContainText(
        "Acquired original oil plants by Dec 2023",
      );
      const plan = scenario.getByRole("region", {
        name: "Supply plan",
        exact: true,
      });
      await expect(plan).not.toContainText(
        /Budget for|Build-time example|Gas example|Lower rates|before selling|order by/i,
      );
      await expect(plan).toContainText("Valley Oil: retirement due Dec 2023");
      if (index === 1)
        await expect(plan).toContainText("Ridge Oil: retirement due Dec 2023");
      await scenario
        .getByRole("button", { name: "Close Scenario", exact: true })
        .click();
      await openPane(
        facilities,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
      await expect(
        facilities.getByRole("button", {
          name: `Inspect ${index === 0 ? "Valley" : "Ridge"} Oil`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        line.getByRole("button", { name: `Acquire ${target}`, exact: true }),
      ).toHaveCount(0);
      const purchased = await readSavedGame(page);
      expect(purchased!.facilities.length).toBeGreaterThan(
        beforeCancel!.facilities.length,
      );
      expect(
        purchased!.utilityExpansion!.acquisitions.some(
          (receipt) =>
            receipt.targetId ===
            (index === 0 ? "valley-electric" : "ridge-electric"),
        ),
      ).toBe(true);
      expect(
        await facilities.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    // The inherited regional connections remain external market access after acquisition.
    await expect(
      facilities.getByRole("combobox", { name: "Market buying", exact: true }),
    ).toBeVisible();
    // Acquired plants and customers use the ordinary shared company controls.
    await openBuild(page);
    await page.getByRole("tab", { name: "Generators", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Operating area", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("slider").first().press("Home");
    await page
      .getByRole("button", { name: "Review purchase of Solar", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Take loan", exact: true })
      .click();
    expect(
      (await readSavedGame(page))?.facilities.some(
        (facility) => facility.name === "Solar",
      ),
    ).toBe(true);
    await openBuild(page);
    await page.getByRole("tab", { name: "Storage", exact: true }).click();
    await page.getByRole("slider").first().press("Home");
    await expect(
      page.getByRole("combobox", { name: "Operating area", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("No storage projects are available in 2005.", {
        exact: true,
      }),
    ).toBeVisible();
    const programs = page.getByRole("region", {
      name: "Programs",
      exact: true,
    });
    await openPane(
      programs,
      page.getByRole("button", { name: "Programs", exact: true }),
    );
    await expect(
      programs.getByRole("combobox", {
        name: "Program operating area",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      programs.getByRole("button", { name: /^Efficiency rebates ·/ }),
    ).toBeVisible();
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      testInfo.project.name === "mobile-390px" &&
      theme === "light"
    ) {
      await expect(page.locator(".MuiSnackbar-root")).toHaveCount(0);
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `programs-${testInfo.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
    const acquired = await readSavedGame(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(
      facilities,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    for (const target of ["Valley", "Ridge"])
      await expect(
        facilities
          .locator(".transmissionLine")
          .filter({ hasText: `${target} expansion connection` }),
      ).toContainText("· Owned");
    const resumed = await readSavedGame(page);
    expect(resumed?.utilityExpansion).toEqual(acquired?.utilityExpansion);
    expect(errors).toEqual([]);
  });
}

test("normal valley play saves across the first year and resumes from IndexedDB", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.addInitScript(() => localStorage.setItem("audioEnabled", "false"));
  await page.goto("/?scenario=116");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await openBuild(page);
  await page.getByRole("tab", { name: "Interties", exact: true }).click();
  await page.getByRole("slider", { name: /Construction tier/ }).press("Home");
  await page
    .getByRole("button", { name: /Review purchase of .*Valley Electric/ })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Pay cash", exact: true })
    .click();
  for (const close of await page
    .locator('.gameToolHeader button[aria-label^="Close "]')
    .all())
    if (await close.isVisible()) await close.click();
  await page.getByRole("button", { name: "fast speed", exact: true }).click();
  await expect
    .poll(async () => (await readSavedGame(page))?.date.monthsElapsed ?? 0, {
      timeout: 60000,
    })
    .toBeGreaterThanOrEqual(13);
  await page.getByRole("button", { name: "pause", exact: true }).click();
  const before = (await readSavedGame(page))!;
  const state = page.locator("#appbar:visible [data-save-state]").first();
  await expect(state).toHaveAttribute("data-save-state", "saved");
  expect(before.monthlyHistory.length).toBeGreaterThanOrEqual(12);
  expect((await readSaveRecords(page))[0].metadata.status).toBe("inProgress");
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const after = (await readSavedGame(page))!;
  expect(after.date.minute).toBeGreaterThanOrEqual(before.date.minute);
  expect(after.monthlyHistory).toEqual(before.monthlyHistory);
  expect(after.transmission?.lines).toEqual(before.transmission?.lines);
  await expect(state).toHaveAttribute("data-save-state", "saved");
  await expect(page.getByText("Save failed", { exact: true })).toHaveCount(0);
});
