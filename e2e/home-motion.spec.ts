import { foregroundContrast } from "./contrast";
import { expect, test } from "./fixtures";

test("reduced motion keeps the home decoration still and actions usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#appStartup")).toHaveCount(0);
  const trace = page.locator("#menuCard .homeEnergyTrace");
  await expect(trace).toBeVisible();
  await expect(trace).toHaveAttribute("aria-hidden", "true");
  expect(
    await trace.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
  await expect(page.locator(".homeEnergyPulse")).toHaveCSS("opacity", "0");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`home keeps discovery links and readable actions after mounting in ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    const authRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/__/auth/iframe"))
        authRequests.push(request.url());
    });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    const explore = page.getByRole("navigation", { name: "Explore Electrify" });
    const paths = [
      "power-grid-simulator",
      "scenarios",
      "classroom",
      "data-centers",
      "energy-simulators",
      "about",
      "privacy",
    ];
    for (const path of paths) {
      const link = explore.locator(`a[href="/${path}.html"]`);
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      expect(
        await link.evaluate(
          (element) => element.getBoundingClientRect().height,
        ),
      ).toBeGreaterThanOrEqual(44);
    }
    expect(await page.locator('a[href^="/"]').count()).toBeGreaterThanOrEqual(
      7,
    );
    expect(
      await page
        .locator("#menuCard")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      await page
        .locator("#logo img")
        .evaluate((element: HTMLImageElement) => element.naturalWidth),
    ).toBeGreaterThan(0);
    expect(authRequests).toEqual([]);
    // The CTAs are the logo blue and stay that blue (see src/CtaColor.test.ts): never darken
    // or lighten them to chase a score. Light's logo blue is 3.7:1 on white by decision.
    const ctas = page.locator("#menuCard .mainActions .MuiButton-root");
    expect(await ctas.count()).toBeGreaterThanOrEqual(2);
    for (const cta of await ctas.all()) {
      expect(await foregroundContrast(cta)).toBeGreaterThanOrEqual(
        theme === "light" ? 3.5 : 4.5,
      );
    }
    const quiet = page.locator(
      "#menuCard :is(.resourceActions, .discoveryActions) .MuiButton-text.MuiButton-colorPrimary, .homeExplore a",
    );
    expect(await quiet.count()).toBeGreaterThanOrEqual(8);
    for (const control of await quiet.all()) {
      expect(await foregroundContrast(control)).toBeGreaterThanOrEqual(4.5);
    }
    await explore.getByRole("link", { name: "For teachers" }).click();
    await expect(page).toHaveURL(/classroom\.html$/);
  });
}
