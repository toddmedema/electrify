import path from "path";
import scenarios from "../site/scenarios.json";
import { expect, test } from "./fixtures";
import { openBuild, openPane } from "./layout";

// The longest challenge and campaign headings stress wrapping in the shared template.
const responsiveSlugs = new Set([
  "sudden-nuclear-shutdown",
  "legacy-a-different-kind-of-growth",
  "deep-freeze", // Preserve the representative static scenario review capture.
]);

test.describe("scenario pages without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const theme of ["light", "dark"] as const) {
    test(`About opens the complete scenario directory in ${theme} mode @minimum-phone`, async ({
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
          fullPage: false,
          animations: "disabled",
        });
      }

      expect(new Set(scenarios.map(({ slug }) => slug)).size).toBe(
        scenarios.length,
      );
      await expect(
        page.getByRole("main").locator("a[href^='/scenarios/']"),
      ).toHaveCount(scenarios.length);
      for (const scenario of scenarios) {
        const pathname = `/scenarios/${scenario.slug}.html`;
        await expect(
          page.getByRole("main").locator(`a[href='${pathname}']`),
        ).toHaveCount(1);
      }
    });

    // Verify every authored page in light mode. Sample the shared styling in dark
    // mode and at the minimum width without repeating every document journey.
    for (const scenario of scenarios) {
      const responsive = responsiveSlugs.has(scenario.slug);
      if (theme === "dark" && !responsive) continue;
      const tags = responsive ? ["@minimum-phone"] : [];
      if (theme === "dark" && scenario.slug === "deep-freeze")
        tags.push("@phone");
      const tag = tags.length ? ` ${tags.join(" ")}` : "";
      test(`${scenario.slug} is readable in ${theme} mode${tag}`, async ({
        page,
      }, info) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto("/scenarios.html");
        await page
          .getByRole("main")
          .locator(`a[href='/scenarios/${scenario.slug}.html']`)
          .click();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          scenario.name,
        );
        await expect(page.getByRole("main")).toContainText(scenario.setup[0]);
        await expect(
          page.getByRole("contentinfo").getByRole("link", {
            name: "How to play",
            exact: true,
          }),
        ).toBeVisible();
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
          await page.evaluate(() =>
            window.scrollTo({ top: 0, behavior: "instant" }),
          );
          await page.screenshot({
            path: path.join(
              process.env.REVIEW_SCREENSHOT_DIR,
              `deep-freeze-${info.project.name}-${theme}.png`,
            ),
            fullPage: info.project.name === "desktop-chromium",
            animations: "disabled",
          });
        }
        await page
          .getByRole("navigation", { name: "Primary navigation" })
          .getByRole("link", { name: "Scenarios", exact: true })
          .click();
        await expect(page).toHaveURL(/\/scenarios\.html$/);
      });
    }
  }
});

test("a landing page opens its challenge details @phone", async ({ page }) => {
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

for (const { id, symbol, theme } of [
  { id: 108, symbol: "€", theme: "light" },
  { id: 115, symbol: "₹", theme: "dark" },
]) {
  test(`scenario ${id} uses local currency for cash, prices and rates in ${theme}${id === 115 ? " @minimum-phone" : ""}`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto(`/?scenario=${id}`);
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const status = page.locator("#appbar:visible").first();
    await expect(status).toContainText(symbol);
    await expect(status).not.toContainText("$");
    const build = await openBuild(page);
    await build.locator(".button-buildGenerator").click();
    const purchase = build
      .getByRole("button", { name: /^Review purchase of / })
      .first();
    await purchase.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(symbol);
    await expect(dialog).not.toContainText("$");
    await page.keyboard.press("Escape");
    const programs = page.getByRole("region", {
      name: "Programs",
      exact: true,
    });
    await openPane(
      programs,
      page.getByRole("button", { name: "Programs", exact: true }),
    );
    const rate = programs.getByRole("slider").first();
    await expect(rate).toHaveAttribute("aria-valuetext", new RegExp(symbol));
    await expect(programs).not.toContainText("¢");
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
}
