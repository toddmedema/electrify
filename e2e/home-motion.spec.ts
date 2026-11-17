import { expect, test } from "./fixtures";

test("reduced motion keeps the home decoration still and actions usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const trace = page.locator(".homeEnergyTrace");
  await expect(trace).toBeVisible();
  await expect(trace).toHaveAttribute("aria-hidden", "true");
  expect(
    await trace.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
  await expect(page.locator(".homeEnergyPulse")).toHaveCSS("opacity", "0");
  await expect(page.getByRole("button", { name: "Play" })).toBeEnabled();
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
      await page.locator("#electrify-wordmark path").count(),
    ).toBeGreaterThan(0);
    expect(authRequests).toEqual([]);
    const contrast = await page
      .locator("#menuCard .MuiButton-textPrimary, .homeExplore a")
      .evaluateAll((elements) => {
        const luminance = (color: string) => {
          const channels = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045
                ? channel / 12.92
                : Math.pow((channel + 0.055) / 1.055, 2.4);
            });
          return (
            channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
          );
        };
        return elements.map((element) => {
          const foreground = luminance(getComputedStyle(element).color);
          const background = luminance(
            getComputedStyle(document.querySelector("#menuCard")!)
              .backgroundColor,
          );
          return (
            (Math.max(foreground, background) + 0.05) /
            (Math.min(foreground, background) + 0.05)
          );
        });
      });
    for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
    await explore.getByRole("link", { name: "For teachers" }).click();
    await expect(page).toHaveURL(/classroom\.html$/);
  });
}
