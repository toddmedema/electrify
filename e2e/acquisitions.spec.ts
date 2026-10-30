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
        name: "Inspect Champlain Electric Oil A",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      facilities.getByRole("button", {
        name: "Inspect Champlain Electric Oil B",
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
      const dialog = page.getByRole("dialog");
      await expect(dialog).toHaveAccessibleName(`Acquire ${target}?`);
      await expectContinuousDialogSurface(dialog);
      await expectDialogToFit(dialog);
      await expect(dialog).toContainText("Assumed debt");
      await expect(dialog).toContainText("Service-network costs");
      await expect(dialog).toContainText("Worst local supply margin");
      await expect(dialog).toContainText("Projected month-end cash");
      await expect(dialog).toContainText("Operating plants");
      await expect(dialog).toContainText("Purchased power");
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
      if (
        process.env.REVIEW_SCREENSHOT_DIR &&
        index === 0 &&
        testInfo.project.name !== "mobile-390px" &&
        theme ===
          (testInfo.project.name === "desktop-chromium" ? "light" : "dark")
      ) {
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
      await expect(
        page.locator(".missionSummaryHeadline:visible"),
      ).toContainText("Retire Champlain's original Oil A");
      await expect(
        page.locator(".missionSummaryHeadline:visible"),
      ).not.toContainText("Acquire");
      await expect(
        line.getByRole("button", { name: `Acquire ${target}`, exact: true }),
      ).toHaveCount(0);
      await expect(
        facilities
          .locator(".facilityAreaLabel")
          .filter({ hasText: target })
          .first(),
      ).toBeVisible();
      expect(
        await facilities.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    // New construction belongs to the chosen operating area, with its local quote context.
    await openBuild(page);
    await page.getByRole("tab", { name: "Generators", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Operating area", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Valley Electric", exact: true })
      .click();
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
        (facility) =>
          facility.name === "Solar" &&
          facility.operatingAreaId === "valley-electric",
      ),
    ).toBe(true);
    await openBuild(page);
    await page.getByRole("tab", { name: "Storage", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Operating area", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Ridge Electric", exact: true })
      .click();
    await page.getByRole("slider").first().press("Home");
    await expect(
      page.getByRole("combobox", { name: "Operating area", exact: true }),
    ).toContainText("Ridge Electric");
    await expect(
      page.getByText(
        "No storage projects are available in this operating area in 2005.",
        { exact: true },
      ),
    ).toBeVisible();
    const programs = page.getByRole("region", {
      name: "Programs",
      exact: true,
    });
    await openPane(
      programs,
      page.getByRole("button", { name: "Programs", exact: true }),
    );
    await page
      .getByRole("combobox", { name: "Program operating area", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Valley Electric", exact: true })
      .click();
    await expect(programs).toContainText(
      "costs and benefits below are for Valley Electric",
    );
    await expect(
      programs.getByRole("button", { name: /^Efficiency rebates ·/ }),
    ).toBeVisible();
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      testInfo.project.name === "mobile-390px" &&
      theme === "light"
    ) {
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
