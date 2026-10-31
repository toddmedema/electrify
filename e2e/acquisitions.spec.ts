import path from "path";
import { expect, test } from "./fixtures";
import { openBuild, openPane } from "./layout";
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
    await expect(
      page.getByText(
        /Acquire Valley Electric or Ridge Electric by the end of 2014/,
      ),
    ).toBeVisible();
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
        "Champlain Electric, January 2020",
        "opening upkeep from January 2015",
      ])
        await expect(terms).toContainText(text);
      if (target === "Valley Electric")
        await expect(terms).toContainText("January 2017");
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
    expect(unfinished?.transmission?.lines).toHaveLength(2);
    expect(
      unfinished?.transmission?.lines.every(
        (line) => line.yearsToBuildLeft > 0,
      ),
    ).toBe(true);
    await editSavedGame(page, ({ game }) => {
      for (const line of game.transmission!.lines) line.yearsToBuildLeft = 0;
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
      const line = facilities
        .locator(".transmissionLine")
        .filter({ hasText: target });
      const acquire = line.getByRole("button", {
        name: `Acquire ${target}`,
        exact: true,
      });
      await expect(acquire).toBeVisible();
      // The ready action is visible without expanding Inspect.
      expect((await acquire.boundingBox())!.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
      await acquire.click();
      const dialog = page.getByRole("dialog", {
        name: `Acquire ${target}?`,
        exact: true,
      });
      await expect(dialog).toHaveAccessibleName(`Acquire ${target}?`);
      await expectContinuousDialogSurface(dialog);
      await expectDialogToFit(dialog);
      await expect(dialog).not.toContainText("Seller equity price");
      await expect(dialog).not.toContainText("Assumed debt");
      await expect(dialog).not.toContainText("Service-network costs");
      await expect(dialog).not.toContainText("Combined debt payments");
      for (const label of ["Cash purchase", "Loan option"]) {
        const payment = dialog
          .locator(".decisionImpactFact")
          .filter({ hasText: new RegExp(`^${label}`) });
        await expect(payment).toHaveCount(1);
        await expect(payment.locator(".decisionImpactFactValue")).toContainText(
          /upfront \+ .*\/mo/,
        );
        await expect(
          payment.locator(".decisionImpactFactDetail"),
        ).toContainText("current network costs included");
        await expect(
          payment.locator(".decisionImpactFactDetail"),
        ).not.toContainText("Plant operations and purchased power vary");
      }
      await expect(dialog).toContainText("Company supply margin");
      await expect(dialog).not.toContainText("Projected month-end cash");
      await expect(dialog).not.toContainText("fee included");
      await expect(dialog).not.toContainText(
        "Acquire either utility by December 2014",
      );
      const plants = dialog
        .locator(".decisionImpactFact")
        .filter({ hasText: /^Operating plants/ })
        .locator(".decisionImpactFactValue");
      await plants.scrollIntoViewIfNeeded();
      const plantLines = (await plants.innerText()).split("\n");
      expect(plantLines).toHaveLength(3);
      const capacities = plantLines.map((line) =>
        Number(line.match(/([\d.]+)MW/)![1]),
      );
      expect(capacities).toEqual([...capacities].sort((a, b) => b - a));
      await expect(dialog).toContainText("Operating plants");
      await expect(dialog).toContainText("Purchased power");
      await expect(dialog).not.toContainText(
        "Ownership, customers, plants and contracts transfer immediately",
      );
      await expect(dialog).not.toContainText(
        "This debt remains after selling plants",
      );
      await expect(dialog).not.toContainText("addressable accounts");
      await dialog.locator(".MuiDialogContent-root").evaluate((element) => {
        element.scrollTop = 0;
      });
      const [titleBox, firstFactBox] = await Promise.all([
        dialog.locator(".closableDialogTitleText").boundingBox(),
        dialog.locator(".decisionImpactFactLabel").first().boundingBox(),
      ]);
      expect(
        firstFactBox!.y - titleBox!.y - titleBox!.height,
      ).toBeLessThanOrEqual(32);
      const loanFact = dialog
        .locator(".decisionImpactFact")
        .filter({ hasText: /^Loan option/ });
      const help = loanFact.getByRole("button", {
        name: "What is interest rate?",
        exact: true,
      });
      await loanFact.scrollIntoViewIfNeeded();
      await expect(loanFact.locator(".decisionImpactFactValue")).toBeInViewport(
        { ratio: 1 },
      );
      await expect(
        loanFact.locator(".decisionImpactFactDetail"),
      ).toBeInViewport({ ratio: 1 });
      const [labelBox, valueBox, iconBox, helpBox] = await Promise.all([
        loanFact.locator(".decisionImpactFactLabel").boundingBox(),
        loanFact.locator(".decisionImpactFactValue").boundingBox(),
        loanFact.locator(":scope > .conceptIcon").boundingBox(),
        help.boundingBox(),
      ]);
      expect(
        Math.abs(
          iconBox!.y + iconBox!.height / 2 - labelBox!.y - labelBox!.height / 2,
        ),
      ).toBeLessThanOrEqual(3);
      expect(helpBox!.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
      expect(helpBox!.x).toBeGreaterThanOrEqual(
        valueBox!.x + valueBox!.width - 1,
      );
      if ((testInfo.project.use.viewport?.width ?? 1280) >= 600) {
        expect(Math.abs(labelBox!.y - valueBox!.y)).toBeLessThanOrEqual(1);
        const cashValueBox = await dialog
          .locator(".decisionImpactFact")
          .filter({ hasText: /^Cash purchase/ })
          .locator(".decisionImpactFactValue")
          .boundingBox();
        expect(Math.abs(cashValueBox!.x - valueBox!.x)).toBeLessThanOrEqual(1);
      }
      await help.focus();
      await page.keyboard.press("Enter");
      const manual = page.getByRole("dialog", {
        name: "Manual help",
        exact: true,
      });
      await expect(
        manual.getByRole("heading", {
          name: "Interest Rates & Inflation",
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(manual).toBeHidden();
      await expect(help).toBeFocused();
      await expect(dialog).toBeVisible();
      if (target === "Valley Electric") {
        const obligations = dialog
          .locator(".decisionImpactFact")
          .filter({ hasText: /^Acquisition obligations/ });
        await expect(obligations).toContainText("January 2017");
        await expect(dialog).not.toContainText("Plan replacement supply");
        await expect(dialog).toContainText(
          "up to 50MW · variable availability",
        );
        await expect(dialog).toContainText("Not firm reserve");
      }
      const beforeCancel = await readSavedGame(page);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
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
      if ((testInfo.project.use.viewport?.width ?? 1280) <= 390) {
        const [cancelBox, cashBox, loanBox] = await Promise.all([
          dialog
            .getByRole("button", { name: "Cancel", exact: true })
            .boundingBox(),
          dialog
            .getByRole("button", { name: "Pay cash", exact: true })
            .boundingBox(),
          dialog
            .getByRole("button", { name: "Take loan", exact: true })
            .boundingBox(),
        ]);
        expect(Math.abs(cashBox!.y - loanBox!.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(cashBox!.width - loanBox!.width)).toBeLessThanOrEqual(
          1,
        );
        expect(cancelBox!.y + cancelBox!.height).toBeLessThanOrEqual(
          cashBox!.y + 1,
        );
        expect(cancelBox!.width).toBeGreaterThanOrEqual(
          cashBox!.width + loanBox!.width,
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
        await page.screenshot({
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
      await purchase.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(line).toContainText(`Owned · ${target}`);
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
        goals.getByText("Retire Champlain's original Oil A", { exact: true }),
      ).toBeVisible();
      await expect(
        goals.getByText("Acquire Valley Electric or Ridge Electric", {
          exact: true,
        }),
      ).toBeVisible();
      const plan = scenario.getByRole("region", {
        name: "Supply plan",
        exact: true,
      });
      await expect(plan).toContainText("Retire original Valley Oil");
      if (index === 1)
        await expect(plan).toContainText("Retire original Ridge Oil");
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
    await expect(
      facilities.getByRole("combobox", { name: "Trading rule", exact: true }),
    ).toHaveCount(0);
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
    await expect(facilities).toContainText("Owned · Valley Electric");
    await expect(facilities).toContainText("Owned · Ridge Electric");
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
