import { reviewScreenshot } from "./review-screenshot";
import path from "path";
import { expectContinuousDialogSurface } from "./dialog-surface";
import { expect, test } from "./fixtures";
import { openBuild, openPane, sortBuildCatalog } from "./layout";
import { editSavedGame, readSavedGame } from "./save-fixture";
import { purchaseTerms } from "../src/helpers/Financials";
import {
  intertieBuildQuote,
  intertieContextForGame,
} from "../src/helpers/Transmission";

for (const theme of ["light", "dark"] as const) {
  for (const [category, name] of [
    ["Generators", "Solar"],
    ["Storage", "Pumped Hydro"],
    ["Interties", "Pacific Northwest"],
  ]) {
    test(`${category} max affordable size stays visible after sorting in ${theme}`, async ({
      page,
    }, info) => {
      await page.addInitScript((mode) => {
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
      }, theme);
      await page.goto("/?scenario=100");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await expect
        .poll(async () => (await readSavedGame(page))?.scenarioId)
        .toBe(100);
      await editSavedGame(page, (save) => {
        const quote = intertieBuildQuote(
          "california-north",
          save.game.date.year,
          1,
          intertieContextForGame(save.game),
        )!;
        const cash =
          category === "Interties"
            ? purchaseTerms(quote.buildCost, true, save.game.interestRate)
                .downpayment
            : 20e6;
        save.game.timeline.forEach((tick) => {
          tick.cash = cash;
        });
      });
      await page.reload();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await openBuild(page);
      await page.getByRole("tab", { name: category, exact: true }).click();
      if (category !== "Interties") await sortBuildCatalog(page, "Build cost");
      const slider = page.getByRole("slider");
      await slider.focus();
      // Use a buildable but unaffordable size for plants; interties have only a few tiers.
      await slider.press(category === "Interties" ? "End" : "Home");
      if (category !== "Interties") {
        await slider.press("ArrowRight");
        for (let index = 0; index < 22; index++)
          await slider.press("ArrowRight");
      }
      const card = page.locator(".buildOption").filter({
        has: page.getByRole("button", {
          name: `Review purchase of ${name}${category === "Interties" ? " intertie" : ""}`,
          exact: true,
        }),
      });
      const review = card.getByRole("button", { name: /Review purchase/ });
      await expect(review).toBeDisabled();
      const before = await slider.getAttribute("aria-valuenow");
      if (
        process.env.REVIEW_SCREENSHOT_DIR &&
        theme === "dark" &&
        category === "Generators"
      ) {
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(
            process.env.REVIEW_SCREENSHOT_DIR,
            `affordable-${info.project.name}.png`,
          ),
          animations: "disabled",
        });
      }
      await card
        .getByRole("button", { name: "Use max size", exact: true })
        .click();
      await expect(slider).not.toHaveAttribute("aria-valuenow", before!);
      await expect(review).toBeEnabled();
      await expect(card.locator(".MuiCardHeader-root")).toBeInViewport({
        ratio: 1,
      });
      // A trial click checks that the resized row is also clear of fixed bars and overlays.
      await review.click({ trial: true });
      await review.click();
      const loan = page
        .getByRole("dialog")
        .getByRole("button", { name: "Take loan", exact: true });
      await expect(loan).toBeEnabled();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "close", exact: true })
        .click();
      await slider.focus();
      await slider.press("ArrowRight");
      await expect(review).toBeDisabled();
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`build options remain compact and usable in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=103");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await openPane(
      page.locator(".facilities"),
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    for (const kind of ["Generator", "Storage"]) {
      await page.locator(".button-buildFacility").click();
      await page.locator(`.button-build${kind}`).click();
      const cards = page.locator(".buildOption");
      const catalogTitle = page.locator(".constructionTitle .iconLabel");
      if (await catalogTitle.locator("svg").isVisible()) {
        const gap = await catalogTitle.evaluate((element) => {
          const text = Array.from(element.childNodes).find(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          )!;
          const range = document.createRange();
          range.selectNodeContents(text);
          const icon = element.querySelector("svg")!.getBoundingClientRect();
          return range.getBoundingClientRect().x - icon.right;
        });
        expect(gap).toBeCloseTo(8, 0);
      }
      const first = cards.first();
      await expect(first).toBeVisible();
      await expect(first).not.toContainText("Construction emissions");
      await expect(page.locator("main.base_main")).toHaveCount(1);
      for (const card of await cards.all()) {
        expect(
          await card.evaluate((el) => el.scrollWidth - el.clientWidth),
        ).toBeLessThanOrEqual(1);
      }
      const metrics = first.locator(".buildOptionMetrics");
      await expect(metrics).toContainText("Build cost");
      await expect(metrics).toContainText("Build time");
      if (kind === "Storage") {
        await expect(metrics).not.toContainText("Energy capacity");
        await expect(
          metrics.locator(".buildOptionMetric").nth(3),
        ).toContainText("At full power");
        await expect(
          metrics.locator(".buildOptionMetric").nth(4),
        ).toContainText("Efficiency");
        for (const description of await cards
          .locator(".buildOptionDescription")
          .all()) {
          const layout = await description.evaluate((element) => ({
            height:
              element.getBoundingClientRect().height -
              parseFloat(getComputedStyle(element).paddingTop) -
              parseFloat(getComputedStyle(element).paddingBottom),
            line: parseFloat(getComputedStyle(element).lineHeight),
          }));
          expect(layout.height).toBeLessThanOrEqual(layout.line + 1);
        }
      } else {
        await expect(metrics).not.toContainText("Typical output");
        const sparklines = page.locator(".buildOptionSparkline svg");
        await expect(sparklines).toHaveCount(await cards.count());
        const strokes = await sparklines.evaluateAll((lines) =>
          lines.map(
            (line) => getComputedStyle(line.querySelector("polyline")!).stroke,
          ),
        );
        expect(strokes.every((stroke) => stroke === strokes[0])).toBe(true);
        expect(strokes[0]).toBe(
          theme === "light" ? "rgb(84, 110, 122)" : "rgb(154, 169, 186)",
        );
        // Metrics reflow at a readable minimum width.
        const cells = await metrics
          .locator(".buildOptionMetric")
          .evaluateAll((els) =>
            els.map((el) => el.getBoundingClientRect().width),
          );
        expect(cells.every((width) => width >= 96)).toBe(true);
      }
      const review = first.getByRole("button", { name: /Review purchase of/ });
      const header = first.locator(".MuiCardHeader-root");
      const box = (await first.boundingBox())!;
      expect(box.height).toBeLessThan(kind === "Generator" ? 310 : 390);
      expect((await review.boundingBox())!.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
      expect((await header.boundingBox())!.height).toBeLessThan(90);
      if (kind === "Generator") {
        const compare = (await first
          .getByRole("button", { name: /^Compare/ })
          .boundingBox())!;
        const reviewBox = (await review.boundingBox())!;
        // Compare sits with Show details at every width; Review stays the header's one action.
        expect(compare.y).toBeGreaterThan(reviewBox.y + reviewBox.height);
      }
      await reviewScreenshot(page, {
        path: testInfo.outputPath(`${kind}-${theme}.png`),
      });
      if (kind === "Generator") {
        await first.getByRole("button", { name: /^Compare/ }).click();
        await expect(
          page.getByRole("region", { name: "Generator comparison" }),
        ).toContainText("Comparing 1/3");
        await page.getByRole("button", { name: "Clear", exact: true }).click();
        const sort = page.getByRole("combobox", { name: "Sort facilities" });
        if (await sort.isVisible()) {
          await sort.click();
          await page.getByRole("option", { name: "Cost per MWh" }).click();
        } else {
          await page.getByRole("button", { name: /^Sort facilities:/ }).click();
          await page.getByRole("menuitem", { name: "Cost per MWh" }).click();
        }
        await expect(first.locator(".buildOptionMetrics")).toContainText(
          "Cost per MWh",
        );
        const sortedCells = await first
          .locator(".buildOptionMetric")
          .evaluateAll((els) =>
            els.map((el) => el.getBoundingClientRect().width),
          );
        expect(sortedCells).toHaveLength(4);
        await expect(first).not.toContainText("Construction emissions");
        expect(sortedCells.every((width) => width >= 96)).toBe(true);
        expect(
          await first.evaluate((el) => el.scrollWidth - el.clientWidth),
        ).toBeLessThanOrEqual(1);
      }
      // Sorting can change the first card. Keep the detail/purchase flow tied to
      // Hydro and resize it through the UI: the default 500 MW exceeds local sites.
      const detailCard =
        kind === "Generator"
          ? cards.filter({
              has: page.getByRole("button", {
                name: "Review purchase of Hydro",
                exact: true,
              }),
            })
          : first;
      const detailReview = detailCard.getByRole("button", {
        name: /Review purchase of/,
      });
      if (kind === "Generator") {
        await expect(detailReview).toBeDisabled();
        await expect(detailCard).toContainText("0 fit");
        await detailCard
          .getByRole("button", { name: "Use site maximum" })
          .click();
        await expect(detailCard.locator(".MuiCardHeader-root")).toBeInViewport({
          ratio: 1,
        });
        await expect(detailCard).not.toContainText("Plant:");
        await expect(page.getByRole("slider")).toHaveAttribute(
          "aria-valuenow",
          "13",
        );
        await expect(detailCard).toContainText("50MW max");
        await expect(detailCard).toContainText("Site: Lake Lynn Hydro Station");
      }
      await expect(detailReview).toBeEnabled();
      await detailCard.getByRole("button", { name: /Show .* details/ }).click();
      await expect(detailCard.locator(".buildOptionDescription")).toBeVisible();
      const properties = detailCard.getByRole("table");
      await expect(properties).toBeVisible();
      for (const row of await properties.getByRole("row").all()) {
        await expect(row.locator(":scope > *")).toHaveCount(3);
        const help = row.getByRole("button");
        if (await help.count()) {
          const cells = await row.locator(":scope > *").all();
          await expect(cells[2].getByRole("button")).toBeVisible();
        }
      }
      if (kind === "Storage") {
        await expect(
          properties.getByRole("row", { name: /Efficiency/ }),
        ).toHaveCount(0);
      }
      await expect(
        detailCard.getByText("Construction emissions", { exact: true }),
      ).toBeVisible();
      // Wait for the disclosure to finish growing before scrolling its last row.
      await expect(detailCard.locator(".MuiCollapse-root")).toHaveClass(
        /MuiCollapse-entered/,
      );
      await detailCard
        .getByText("Construction emissions", { exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        detailCard.getByText("Construction emissions", { exact: true }),
      ).toBeInViewport();
      await reviewScreenshot(page, {
        path: testInfo.outputPath(`${kind}-details-${theme}.png`),
        animations: "disabled",
      });
      if (
        process.env.REVIEW_SCREENSHOT_DIR &&
        ((theme === "light" && testInfo.project.name === "desktop-chromium") ||
          (theme === "dark" && testInfo.project.name === "mobile-390px"))
      ) {
        await detailCard.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(
            process.env.REVIEW_SCREENSHOT_DIR,
            `${kind}-details-${theme}-${testInfo.project.name}.png`,
          ),
          animations: "disabled",
        });
      }
      await detailReview.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const dialog = page.getByRole("dialog");
      await expectContinuousDialogSurface(dialog);
      const title = dialog.locator(".closableDialogTitleText");
      const close = dialog.getByRole("button", { name: "close", exact: true });
      const titleBox = (await title.boundingBox())!;
      const closeBox = (await close.boundingBox())!;
      expect(titleBox.x + titleBox.width + 7).toBeLessThanOrEqual(closeBox.x);
      expect(closeBox.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
      const actionStyles = await dialog
        .locator(".MuiDialogActions-root")
        .evaluate((element) => ({
          gap: getComputedStyle(element).gap,
          bottom: parseFloat(getComputedStyle(element).paddingBottom),
          margins: Array.from(element.children).map(
            (child) => getComputedStyle(child).marginLeft,
          ),
        }));
      expect(actionStyles.gap).toBe("8px");
      expect(actionStyles.bottom).toBeGreaterThanOrEqual(16);
      expect(actionStyles.margins.every((margin) => margin === "0px")).toBe(
        true,
      );
      await expect(
        page.getByRole("button", { name: "Pay cash", exact: true }),
      ).toBeVisible();
      if (kind === "Storage") {
        await reviewScreenshot(page, {
          path: testInfo.outputPath(`Storage-purchase-${theme}.png`),
          animations: "disabled",
        });
      }
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "close" })
        .click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await page
        .getByRole("button", { name: "Close Build", exact: true })
        .click();
      await expect(cards).toHaveCount(0);
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`battery metrics in ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await openPane(
      page.locator(".facilities"),
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await page.locator(".button-buildFacility").click();
    await page.locator(".button-buildStorage").click();
    const battery = page.locator(".buildOption").filter({
      has: page.getByRole("button", {
        name: /^(Show|Hide) Lithium Battery details$/,
      }),
    });
    await expect(battery).toBeVisible();
    await expect(page.locator("main.base_main")).toHaveCount(1);
    await expect(battery.locator(".buildOptionMetrics")).toContainText("4 hr");
    await expect(battery.locator(".buildOptionMetrics")).toContainText("250MW");
    await expect(battery.locator(".buildOptionMetrics")).not.toContainText(
      "Energy capacity",
    );
    await expect(
      battery
        .locator(".buildOptionMetrics")
        .locator(".buildOptionMetric")
        .nth(3),
    ).toContainText("At full power");
    await expect(
      battery
        .locator(".buildOptionMetrics")
        .locator(".buildOptionMetric")
        .nth(4),
    ).toHaveText("Efficiency85%");
    expect(
      await battery.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`Storage-modern-${theme}.png`),
    });
    await battery
      .getByRole("button", { name: "Show Lithium Battery details" })
      .click();
    await expect(battery.getByRole("row", { name: /Efficiency/ })).toHaveCount(
      0,
    );
    const lossHelp = battery
      .getByRole("row", { name: /Stored energy lost per hour/ })
      .getByRole("button");
    await expect(lossHelp).toHaveAccessibleName(
      "What is stored energy lost per hour?",
    );
    await expect(battery).not.toContainText(
      "Full-power duration assumes a full charge",
    );
    await expect(
      battery.getByRole("row", { name: /Stored energy lost per hour/ }),
    ).toContainText("0.01%");
    await battery
      .getByRole("button", { name: "Hide Lithium Battery details" })
      .click();
    await page.getByRole("slider").focus();
    await page.getByRole("slider").press("End");
    const maxSize = battery.getByRole("button", { name: "Use max size" });
    await expect(maxSize).toBeVisible();
    await expect(battery.locator(".MuiCardHeader-root")).toContainText(
      "This project size is not available",
    );
    await expect(battery.locator(".buildOptionWarning")).toHaveCount(0);
    expect(
      await battery.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`Storage-max-size-${theme}.png`),
    });
    await maxSize.click();
    await expect(battery.locator(".MuiCardHeader-root")).toBeInViewport({
      ratio: 1,
    });
    await expect(
      battery.getByRole("button", {
        name: "Review purchase of Lithium Battery",
      }),
    ).toBeEnabled();
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`iron-air purchase from 2030 in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [
            { scenarioId: 0, timesPlayed: 1, date: new Date().toString() },
          ],
        }),
      );
    }, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page
      .getByRole("button", { name: "View Custom Game details" })
      .click();
    const year = page.getByRole("combobox", { name: "Starting year" });
    await year.click();
    await page.getByRole("option", { name: "2030", exact: true }).click();
    await page
      .locator(".customSetupActions")
      .getByRole("button", { name: "Play", exact: true })
      .click();
    await expect(page.locator("#appbar:visible").first()).toBeVisible();
    const build = await openBuild(page);
    await build.getByRole("tab", { name: "Storage", exact: true }).click();
    // The default custom fleet opens at 2 GWh. Select a 1 GWh / 10 MW project.
    const size = build.getByRole("slider");
    await size.press("ArrowLeft");
    await expect(size).toHaveAccessibleName("Capacity 1GWh");
    const ironAir = page.locator(".buildOption").filter({
      has: page.getByRole("button", {
        name: /^(Show|Hide) Iron-Air Battery details$/,
      }),
    });
    await expect(ironAir).toBeVisible();
    await expect(ironAir.locator(".buildOptionMetrics")).toContainText(
      "100 hr",
    );
    await expect(ironAir.locator(".buildOptionMetrics")).toContainText("10MW");
    await expect(
      ironAir
        .locator(".buildOptionMetrics")
        .locator(".buildOptionMetric")
        .nth(3),
    ).toContainText("At full power");
    await expect(
      ironAir
        .locator(".buildOptionMetrics")
        .locator(".buildOptionMetric")
        .nth(4),
    ).toHaveText("Efficiency43%");
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`Storage-iron-air-${theme}.png`),
      animations: "disabled",
    });
    await ironAir
      .getByRole("button", {
        name: "Show Iron-Air Battery details",
        exact: true,
      })
      .click();
    await expect(ironAir.getByRole("row", { name: /Upkeep/ })).toBeVisible();
    await expect(ironAir.getByRole("row", { name: /Efficiency/ })).toHaveCount(
      0,
    );
    expect(
      await ironAir.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await ironAir
      .getByRole("button", {
        name: "Review purchase of Iron-Air Battery",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Iron-Air Battery");
    await dialog.getByRole("button", { name: "Pay cash", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(async () =>
        (await readSavedGame(page))?.facilities.some(
          (facility) =>
            facility.name === "Iron-Air Battery" &&
            facility.peakWh === 1000000000,
        ),
      )
      .toBe(true);
  });
}
