import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

for (const theme of ["light", "dark"]) {
  test(`build pauses survive browser lifecycle events in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=103");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const slow = page.getByRole("button", { name: "slow speed", exact: true });
    const pause = page.getByRole("button", { name: "pause", exact: true });
    await slow.click();
    await expect(slow).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      ),
    );
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    );
    await expect(slow).toHaveAttribute("aria-pressed", "true");
    await openPane(
      page.locator(".facilities"),
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    // Browsers use visibilitychange when a tab or mobile app is backgrounded.
    // Keep it independently exercised from the pagehide/pageshow fallback above.
    const visibility = async (state: "hidden" | "visible") => {
      await page.evaluate((value) => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      }, state);
    };
    await visibility("hidden");
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    await visibility("visible");
    await expect(slow).toHaveAttribute("aria-pressed", "true");
    await page.locator(".button-buildFacility").click();
    await visibility("hidden");
    await visibility("visible");
    await expect(page.locator(".pausedChip")).toHaveText("Paused");
    for (const name of ["Storage", "Interties", "Generators"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(page.locator(".pausedChip")).toHaveText("Paused");
    }
    await expect(page.locator("main.base_main")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    // Let the tab indicator and touch ripples settle for the review image.
    await page.waitForTimeout(600);
    await page.screenshot({
      path: testInfo.outputPath(`build-paused-${theme}.png`),
    });
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      ),
    );
    await page.locator("#close-button").click();
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    );
    await expect(slow).toHaveAttribute("aria-pressed", "true");
    // Browser Back and a completed purchase also restore the pre-build speed.
    await page.locator(".button-buildFacility").click();
    await page.goBack();
    await expect(slow).toHaveAttribute("aria-pressed", "true");
    await page.locator(".button-buildFacility").click();
    await page
      .getByRole("button", { name: /Review purchase of/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Take loan", exact: true }).click();
    await expect(slow).toHaveAttribute("aria-pressed", "true");
    await pause.click();
    await page.locator(".button-buildFacility").click();
    await page.locator("#close-button").click();
    await expect(pause).toHaveAttribute("aria-pressed", "true");
  });
}
