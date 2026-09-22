import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

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
      const first = cards.first();
      await expect(first).toBeVisible();
      await expect(first).not.toContainText("Construction emits");
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
        await expect(metrics).toContainText("Round-trip efficiency");
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
        expect(cells.every((width) => width >= 128)).toBe(true);
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
        if (page.viewportSize()!.width >= 600) {
          expect(compare.y).toBeCloseTo(reviewBox.y, 0);
          expect(reviewBox.x - (compare.x + compare.width)).toBeCloseTo(4, 0);
        } else {
          expect(compare.y).toBeGreaterThan(reviewBox.y + reviewBox.height);
        }
      }
      await page.screenshot({
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
        await expect(first).not.toContainText("Construction emits");
        expect(sortedCells.every((width) => width >= 128)).toBe(true);
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
        await expect(detailCard).toContainText("Plant: 51.2MW");
        await expect(detailCard).toContainText("Site: Lake Lynn Hydro Station");
      }
      await expect(detailReview).toBeEnabled();
      await detailCard.getByRole("button", { name: /Show .* details/ }).click();
      await expect(detailCard.locator(".buildOptionDescription")).toBeVisible();
      await expect(detailCard.getByRole("table")).toBeVisible();
      await expect(
        detailCard.getByText("Construction emits", { exact: true }),
      ).toBeVisible();
      await detailCard
        .getByText("Construction emits", { exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        detailCard.getByText("Construction emits", { exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath(`${kind}-details-${theme}.png`),
        animations: "disabled",
      });
      await detailReview.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const dialog = page.getByRole("dialog");
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
        await page.screenshot({
          path: testInfo.outputPath(`Storage-purchase-${theme}.png`),
          animations: "disabled",
        });
      }
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "close" })
        .click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await page.getByRole("button", { name: "close", exact: true }).click();
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
      has: page.getByRole("button", { name: /Battery details/ }),
    });
    await expect(battery).toBeVisible();
    await expect(page.locator("main.base_main")).toHaveCount(1);
    await expect(battery.locator(".buildOptionMetrics")).toContainText("4 hr");
    await expect(battery.locator(".buildOptionMetrics")).toContainText("125MW");
    await expect(battery.locator(".buildOptionMetrics")).toContainText("85%");
    expect(
      await battery.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`Storage-modern-${theme}.png`),
    });
    await battery.getByRole("button", { name: "Show Battery details" }).click();
    await expect(battery).not.toContainText(
      "Full-power duration assumes a full charge",
    );
    await expect(
      battery.getByRole("row", { name: /Stored energy lost per hour/ }),
    ).toContainText("0.01%");
  });
}
