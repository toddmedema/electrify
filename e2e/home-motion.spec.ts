import { expectReadableText, foregroundContrast } from "./contrast";
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
    await expect(page.locator("#appStartup")).toHaveCount(0);
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
    // Every button and link here is the logo blue and stays that blue (see
    // src/CtaColor.test.ts): never darken or lighten one to chase a score. Light's logo
    // blue is 3.7:1 on white by decision, so it holds the floor the repo uses for
    // logo-blue fills (3.5:1); dark keeps WCAG AA.
    const controls = page.locator(
      "#menuCard :is(.mainActions, .resourceActions, .discoveryActions) .MuiButton-root, #menuCard .homeExplore a",
    );
    expect(await controls.count()).toBeGreaterThanOrEqual(10);
    for (const control of await controls.all()) {
      expect(await foregroundContrast(control)).toBeGreaterThanOrEqual(
        theme === "light" ? 3.5 : 4.5,
      );
    }
    for (const link of await explore.getByRole("link").all()) {
      await expectReadableText(link);
    }
    // Tab from the preceding link so coarse-pointer projects use keyboard focus styling.
    await explore
      .getByRole("link", { name: "Compare simulators" })
      .press("Tab");
    const about = explore.getByRole("link", { name: "About", exact: true });
    await expect(about).toBeFocused();
    await expect(about).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(0, 132, 248)" : "rgb(98, 155, 225)",
    );
    expect(await foregroundContrast(about)).toBeGreaterThanOrEqual(
      theme === "light" ? 3.5 : 4.5,
    );
    await expectReadableText(about);
    await explore.getByRole("link", { name: "For teachers" }).click();
    await expect(page).toHaveURL(/classroom\.html$/);
  });
}
