import path from "path";
import { expect, test } from "./fixtures";
import { openBuild, openPane } from "./layout";
import { expectDialogToFit } from "./dialog-layout";
import { expectContinuousDialogSurface } from "./dialog-surface";
import { editSavedGame, readSavedGame } from "./save-fixture";

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
      const inspect = line.getByRole("button", { name: /^Inspect / });
      if ((await inspect.getAttribute("aria-expanded")) !== "true")
        await inspect.click();
      const acquire = line.getByRole("button", {
        name: `Acquire ${target}`,
        exact: true,
      });
      await expect(acquire).toBeVisible();
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
      await expect(dialog).toContainText("Assumed debt");
      await expect(dialog).toContainText("Service-network costs");
      await expect(dialog).toContainText("Company supply margin");
      await expect(dialog).toContainText("Projected month-end cash");
      await expect(dialog).toContainText("Operating plants");
      await expect(dialog).toContainText("Purchased power");
      await expect(dialog).not.toContainText(
        "Ownership, customers, plants and contracts transfer immediately",
      );
      await expect(dialog).not.toContainText(
        "This debt remains after selling plants",
      );
      await expect(dialog).not.toContainText("addressable accounts");
      const [titleBox, introBox] = await Promise.all([
        dialog.locator(".closableDialogTitleText").boundingBox(),
        dialog
          .locator(".acquisitionReviewIntro .MuiTypography-root")
          .first()
          .boundingBox(),
      ]);
      expect(introBox!.y - titleBox!.y - titleBox!.height).toBeLessThanOrEqual(
        20,
      );
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
        await expect(dialog).toContainText("January 2017");
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
        if (testInfo.project.name === "mobile-360px") {
          await loanFact.scrollIntoViewIfNeeded();
          await expect(
            loanFact.locator(".decisionImpactFactValue"),
          ).toBeInViewport({ ratio: 1 });
          await expect(
            loanFact.locator(".decisionImpactFactDetail"),
          ).toBeInViewport({ ratio: 1 });
        }
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
      await expect(line).toContainText("Connection upkeep");
      await expect(
        line.getByRole("button", {
          name: /^Review upgrade|^Pause|^Resume|^Reorder/,
        }),
      ).toHaveCount(0);
      await expect(line).not.toContainText("Transfer capacity");
      await expect(
        page.locator(".missionSummaryHeadline:visible"),
      ).toContainText("Retire Champlain's original Oil A");
      await expect(
        page.locator(".missionSummaryHeadline:visible"),
      ).not.toContainText("Acquire");
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
