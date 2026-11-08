import path from "path";
import scenarios from "../site/scenarios.json";
import { expect, test } from "./fixtures";

test.describe("scenario pages without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const theme of ["light", "dark"] as const) {
    test(`the directory leads to every readable scenario in ${theme} mode`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/about.html");
      await page
        .getByRole("link", { name: "Explore the official scenarios" })
        .click();
      await expect(page).toHaveURL(/\/scenarios\.html$/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(page.viewportSize()!.width);
      if (
        process.env.REVIEW_SCREENSHOT_DIR &&
        theme === "light" &&
        info.project.name === "desktop-chromium"
      ) {
        await page.screenshot({
          path: path.join(
            process.env.REVIEW_SCREENSHOT_DIR,
            "scenarios-desktop.png",
          ),
          fullPage: true,
          animations: "disabled",
        });
      }

      for (const scenario of scenarios) {
        const pathname = `/scenarios/${scenario.slug}.html`;
        await expect(
          page.getByRole("main").locator(`a[href='${pathname}']`),
        ).toHaveCount(1);
      }

      for (const scenario of scenarios) {
        await page
          .getByRole("main")
          .locator(`a[href='/scenarios/${scenario.slug}.html']`)
          .click();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          scenario.name,
        );
        await expect(page.getByRole("main")).toContainText(scenario.setup[0]);
        await expect(page.locator("link[rel='canonical']")).toHaveAttribute(
          "href",
          `https://electrifygame.com/scenarios/${scenario.slug}.html`,
        );
        await expect(page.locator(".hero .button--primary")).toHaveAttribute(
          "href",
          scenario.kind === "campaign"
            ? "/?campaign=legacy"
            : `/?scenario=${scenario.scenarioId}`,
        );
        for (const image of await page.locator("main img").all()) {
          await image.scrollIntoViewIfNeeded();
          await expect
            .poll(() =>
              image.evaluate(
                (element: HTMLImageElement) => element.naturalWidth,
              ),
            )
            .toBeGreaterThan(0);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(page.viewportSize()!.width);
        if (
          process.env.REVIEW_SCREENSHOT_DIR &&
          scenario.scenarioId === 107 &&
          ((theme === "light" && info.project.name === "desktop-chromium") ||
            (theme === "dark" && info.project.name === "mobile-390px"))
        ) {
          await page.screenshot({
            path: path.join(
              process.env.REVIEW_SCREENSHOT_DIR,
              `deep-freeze-${info.project.name}-${theme}.png`,
            ),
            fullPage: true,
            animations: "disabled",
          });
        }
        await page
          .getByRole("navigation", { name: "Primary navigation" })
          .getByRole("link", { name: "Scenarios", exact: true })
          .click();
        await expect(page).toHaveURL(/\/scenarios\.html$/);
      }
    });
  }
});

test("a landing page opens its challenge details", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("audioEnabled", "false"));
  const scenario = scenarios.find((entry) => entry.scenarioId === 107)!;
  await page.goto(`/scenarios/${scenario.slug}.html`);
  await page.locator(".hero .button--primary").click();
  await expect(
    page.getByRole("heading", { name: "Deep Freeze", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start game", exact: true }),
  ).toBeVisible();
});

test("a later generation opens campaign setup", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("audioEnabled", "false"));
  const scenario = scenarios.find((entry) => entry.scenarioId === 125)!;
  await page.goto(`/scenarios/${scenario.slug}.html`);
  await page.locator(".hero .button--primary").click();
  await expect(page).toHaveURL(/\?campaign=legacy$/);
  await expect(page.getByRole("heading", { name: /Legacy/ })).toBeVisible();
});
