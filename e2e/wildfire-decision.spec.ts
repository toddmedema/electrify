import { expect, test } from "@playwright/test";
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
    const region = page.getByRole("dialog", { name: "Wildfire preparedness" });
    await expect(region).toBeVisible({ timeout: 30000 });
    const fund = region.getByRole("button", { name: "Fund preparedness" });
    await expect(fund).toBeEnabled();
    await expect(region).toContainText("Game paused");
    await expect(region).toContainText("Normal restoration costs still apply");
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
      const costBox = (await region
        .getByText("One-time cost:", { exact: false })
        .boundingBox())!;
      const keepCashBox = (await region
        .getByRole("button", { name: "Keep cash" })
        .boundingBox())!;
      // Keep the cost attached to its own action and separate from the next choice.
      expect(costBox.y - (fundBox.y + fundBox.height)).toBeLessThanOrEqual(8);
      expect(
        keepCashBox.y - (costBox.y + costBox.height),
      ).toBeGreaterThanOrEqual(16);
      expect(keepCashBox.x).toBe(fundBox.x);
      expect(keepCashBox.width).toBe(fundBox.width);
    }
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
    if (!(await page.locator(".eventLog:visible").isVisible()))
      await page.getByRole("button", { name: "Events", exact: true }).click();
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
