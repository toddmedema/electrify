import { expect, test } from "@playwright/test";

for (const scenario of [106, 107]) {
  for (const theme of ["light", "dark"]) {
    test(`scenario ${scenario} requires a clear, persistent choice in ${theme}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90000);
      await page.addInitScript((mode) => {
        if (!sessionStorage.getItem("choice-test-started")) {
          localStorage.clear();
          localStorage.setItem("theme", mode);
          sessionStorage.setItem("choice-test-started", "true");
        }
      }, theme);
      await page.goto(`/?scenario=${scenario}`);
      await page.getByRole("button", { name: "Beginner", exact: true }).click();
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const fast = page
        .locator("#appbar:visible")
        .getByRole("button", { name: "fast speed" })
        .first();
      await fast.click();
      const dialog = page.getByRole("dialog", {
        name:
          scenario === 106
            ? "Negotiate the data-center connection"
            : "Prepare for the deep freeze",
      });
      await expect(dialog).toBeVisible({ timeout: 60000 });
      await expect(dialog).toContainText("Game paused");
      await expect(dialog.getByRole("button")).toHaveCount(2);
      if (scenario === 106) {
        await expect(dialog).toContainText("One-time funding:");
        await expect(dialog).toContainText("2026");
        await expect(dialog).toContainText("2028");
      } else {
        await expect(dialog).toContainText("One-time cost:");
        await expect(dialog).toContainText(/gas.price/i);
      }
      await expect(dialog).toContainText("No upfront cost");
      const paused = await page.locator("#appbar:visible").first().innerText();
      await page.keyboard.press("Escape");
      await page.keyboard.press("3");
      await page.mouse.click(1, 1);
      await page.waitForTimeout(400);
      await expect(dialog).toBeVisible();
      expect(await page.locator("#appbar:visible").first().innerText()).toBe(
        paused,
      );
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
      expect(
        await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      for (const button of await dialog.getByRole("button").all()) {
        await expect(button).toBeEnabled();
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(
          page.viewportSize()!.width,
        );
      }
      await page.screenshot({
        path: testInfo.outputPath(`scenario-${scenario}-${theme}.png`),
      });
      const chosen = dialog.getByRole("button").nth(theme === "light" ? 0 : 1);
      await chosen.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).not.toBeVisible();
      // Leaving the page flushes the accepted response through the real autosave path.
      await page.goto("/");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.locator("#appbar:visible").first()).toBeVisible();
      await expect(dialog).not.toBeVisible();
      await fast.click();
      await expect
        .poll(async () => page.locator("#appbar:visible").first().innerText())
        .not.toBe(paused);
      await expect(dialog).not.toBeVisible();
    });
  }
}
