import { expect, test } from "./fixtures";

for (const scheme of ["light", "dark"] as const) {
  test(`the simulator guide stays readable and serves a responsive screenshot in ${scheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/power-grid-simulator.html");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Questions before you play" }),
    ).toBeVisible();
    const screenshot = page.locator(".learning-screenshot img");
    await screenshot.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        screenshot.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    const delivered = await screenshot.evaluate(
      async (image: HTMLImageElement) => {
        const bitmap = await createImageBitmap(
          await (await fetch(image.currentSrc)).blob(),
        );
        const pixels = bitmap.width;
        bitmap.close();
        return {
          src: image.currentSrc,
          pixels,
          displayed: image.getBoundingClientRect().width,
          scale: devicePixelRatio,
        };
      },
    );
    expect(delivered.src).toMatch(/gameplay-preview-(400|800|1200)\.webp$/);
    expect(delivered.pixels).toBeGreaterThanOrEqual(
      Math.floor(delivered.displayed * Math.min(delivered.scale, 1)),
    );
    if (page.viewportSize()!.width <= 390 && delivered.scale === 1)
      expect(delivered.pixels).toBeLessThanOrEqual(400);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()!.width);

    // Check the actual text/background pairs, including inherited transparent backgrounds.
    const contrast = await page
      .locator(".topnav__play, .eyebrow, .hero .button--primary")
      .evaluateAll((elements) => {
        const luminance = (color: string) => {
          const values = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((channel) => {
              const value = channel / 255;
              return value <= 0.04045
                ? value / 12.92
                : Math.pow((value + 0.055) / 1.055, 2.4);
            });
          return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
        };
        return elements.map((element) => {
          let parent: Element | null = element;
          let background = "rgba(0, 0, 0, 0)";
          while (parent && background === "rgba(0, 0, 0, 0)") {
            background = getComputedStyle(parent).backgroundColor;
            parent = parent.parentElement;
          }
          const text = luminance(getComputedStyle(element).color);
          const surface = luminance(background);
          return {
            text: element.textContent!.trim(),
            ratio:
              (Math.max(text, surface) + 0.05) /
              (Math.min(text, surface) + 0.05),
          };
        });
      });
    expect(contrast.length).toBeGreaterThanOrEqual(3);
    for (const pair of contrast)
      expect(pair.ratio, pair.text).toBeGreaterThanOrEqual(4.5);
  });
}
