import { expect, test } from "@playwright/test";

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
    if (!(await page.locator("#facilitiesPane").isVisible())) {
      await page
        .getByRole("button", { name: "Facilities", exact: true })
        .click();
    }
    for (const kind of ["Generator", "Storage"]) {
      await page.locator(`.button-build${kind}`).click();
      const cards = page.locator(".buildOption");
      const first = cards.first();
      await expect(first).toBeVisible();
      await expect(page.locator("main.base_main")).toHaveCount(1);
      for (const card of await cards.all()) {
        expect(
          await card.evaluate((el) => el.scrollWidth - el.clientWidth),
        ).toBeLessThanOrEqual(1);
      }
      const metrics = first.locator(".buildOptionMetrics");
      await expect(metrics).toContainText("Build cost");
      await expect(metrics).toContainText("Build time");
      await expect(metrics).toContainText(
        kind === "Storage" ? "Round-trip efficiency" : "Typical output",
      );
      const review = first.getByRole("button", { name: /Review purchase of/ });
      const header = first.locator(".MuiCardHeader-root");
      const box = (await first.boundingBox())!;
      expect(box.height).toBeLessThan(kind === "Generator" ? 230 : 285);
      expect((await review.boundingBox())!.height).toBeGreaterThanOrEqual(
        testInfo.project.use.hasTouch ? 44 : 40,
      );
      expect((await header.boundingBox())!.height).toBeLessThan(90);
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
          "Lifetime cost / MWh",
        );
        expect(
          await first.evaluate((el) => el.scrollWidth - el.clientWidth),
        ).toBeLessThanOrEqual(1);
      }
      await first.getByRole("button", { name: /Show .* details/ }).click();
      await expect(first.locator(".buildOptionDescription")).toBeVisible();
      await expect(first.getByRole("table")).toBeVisible();
      await review.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Pay cash", exact: true }),
      ).toBeVisible();
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
    if (!(await page.locator("#facilitiesPane").isVisible())) {
      await page
        .getByRole("button", { name: "Facilities", exact: true })
        .click();
    }
    await page.locator(".button-buildStorage").click();
    const battery = page.locator(".buildOption").filter({
      has: page.getByRole("button", { name: /Battery details/ }),
    });
    await expect(battery).toBeVisible();
    await expect(page.locator("main.base_main")).toHaveCount(1);
    await expect(battery.locator(".buildOptionMetrics")).toContainText("4 h");
    await expect(battery.locator(".buildOptionMetrics")).toContainText("125MW");
    await expect(battery.locator(".buildOptionMetrics")).toContainText("85%");
    expect(
      await battery.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`Storage-modern-${theme}.png`),
    });
    await battery.getByRole("button", { name: "Show Battery details" }).click();
    await expect(battery).toContainText(
      "Full-power duration assumes a full charge",
    );
    await expect(
      battery.getByRole("row", { name: /Stored energy lost per hour/ }),
    ).toContainText("0.01%");
  });
}
