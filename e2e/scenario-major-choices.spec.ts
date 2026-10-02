import { expect, test } from "./fixtures";

for (const scenario of [106, 107]) {
  for (const theme of ["light", "dark"]) {
    test(`scenario ${scenario} requires a clear, persistent choice in ${theme}`, async ({
      page,
    }, testInfo) => {
      // The data-center choice comes due 48 game months in, about a minute at fast speed
      test.setTimeout(180000);
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
      // Critical weather/news can pause the clock before the required story choice.
      // Resume those pauses, but leave every modal for the assertions below to inspect.
      await expect
        .poll(
          async () => {
            if (await dialog.isVisible()) return true;
            if (
              (await page.getByRole("dialog").count()) === 0 &&
              (await fast.getAttribute("aria-pressed")) === "false"
            ) {
              await fast.click();
            }
            return dialog.isVisible();
          },
          { timeout: 120000, intervals: [1000] },
        )
        .toBe(true);
      await expect(dialog).toContainText("Paused");
      await expect(dialog.getByRole("button")).toHaveCount(2);
      if (scenario === 106) {
        await expect(dialog).toContainText(
          "Receive $15M to connect all 100 MW in January 2026.",
        );
        await expect(dialog).toContainText("2026");
        await expect(dialog).toContainText("2028");
      } else {
        await expect(dialog).toContainText("Fund winterization ($90M)");
        await expect(dialog).toContainText(/gas.price/i);
      }
      await expect(dialog).toContainText(
        scenario === 106 ? "Forgo funding" : "Keep construction budget",
      );
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
