import { expectDialogToFit } from "./dialog-layout";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
for (const theme of ["light", "dark"]) {
  test(`wildfire response is actionable and persistent in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=111");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const fast = page
      .locator("#appbar:visible")
      .getByRole("button", { name: "fast speed" })
      .first();
    await fast.click();
    const region = page.getByRole("dialog", { name: /Wildfire preparedness/ });
    await expect(region).toBeVisible({ timeout: 75000 });
    await expectDialogToFit(region);
    const fund = region.getByRole("button", {
      name: /^Fund preparedness \(\$2M\)$/,
    });
    await expect(fund).toBeEnabled();
    await expect(region).toContainText("Paused");
    await expect(region).not.toContainText("Spend $2M");
    await expect(region).toContainText("pre-position repair crews");
    await expect(region).not.toContainText("Cash available");
    const titleInset = await region
      .locator("#scenarioChoiceTitle")
      .evaluate(
        (el) =>
          el.getBoundingClientRect().left +
          parseFloat(getComputedStyle(el).paddingLeft),
      );
    const descriptionBox = (await region
      .locator("#scenarioChoiceDescription")
      .boundingBox())!;
    expect(titleInset).toBe(descriptionBox.x);
    expect(
      await region.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    if (page.viewportSize()!.width < 600) {
      const dialogBox = (await region.boundingBox())!;
      expect(dialogBox.width).toBeGreaterThanOrEqual(
        page.viewportSize()!.width - 32,
      );
      const fundBox = (await fund.boundingBox())!;
      const keepCashBox = (await region
        .getByRole("button", { name: "Keep cash" })
        .boundingBox())!;
      expect(keepCashBox.y - (fundBox.y + fundBox.height)).toBeGreaterThan(0);
      expect(keepCashBox.x).toBe(fundBox.x);
      expect(keepCashBox.width).toBe(fundBox.width);
    }
    // The pause icon shares a centerline with its label
    const chip = region.locator(".pausedChip");
    const chipBox = (await chip.boundingBox())!;
    const iconBox = (await chip.locator("svg").boundingBox())!;
    expect(
      Math.abs(
        iconBox.y + iconBox.height / 2 - (chipBox.y + chipBox.height / 2),
      ),
    ).toBeLessThanOrEqual(1);
    for (const button of await region.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      );
    }
    const pausedStatus = await page
      .locator("#appbar:visible")
      .first()
      .innerText();
    await page.keyboard.press("Escape");
    await page.keyboard.press("3");
    await page.mouse.click(1, 1);
    await expect(region).toBeVisible();
    await page.waitForTimeout(400);
    expect(await page.locator("#appbar:visible").first().innerText()).toBe(
      pausedStatus,
    );
    await page.keyboard.press("Tab");
    expect(
      await region.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await fund.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`wildfire-choice-${theme}.png`),
    });
    await (
      theme === "light"
        ? fund
        : region.getByRole("button", { name: "Keep cash" })
    ).focus();
    await page.keyboard.press("Enter");
    await expect(region).not.toBeVisible();
    const eventLog = page.locator(".eventLog:visible");
    await openPane(
      eventLog,
      page.getByRole("button", { name: "Events", exact: true }),
    );
    await fast.click();
    await expect(page.getByText("Through Feb 2025")).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByText(
        theme === "light"
          ? /Prepared crews are in place/
          : /Standard response is in place/,
      ),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`wildfire-outcome-${theme}.png`),
    });
  });
}
