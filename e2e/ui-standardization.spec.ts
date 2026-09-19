import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`custom setup inputs and map targets are legible in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [
            { scenarioId: 0, timesPlayed: 1, date: new Date().toString() },
          ],
        }),
      );
    }, theme);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Start playing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "View Custom Game details" })
      .click();
    const seed = page.getByRole("textbox", { name: "Seed", exact: true });
    await seed.scrollIntoViewIfNeeded();
    await expect(seed).toBeVisible();
    const inputBorder = await seed.evaluate((input) => {
      const root = input.closest(".MuiInputBase-root")!;
      const outline = root.querySelector("fieldset");
      return getComputedStyle(outline || root, outline ? null : "::before")
        .borderBottomWidth;
    });
    expect(parseFloat(inputBorder)).toBeGreaterThan(0);
    const facilitySelectors = page.locator(
      ".customFacilityPicker [role=combobox]",
    );
    await expect(facilitySelectors).toHaveCount(2);
    for (const select of await facilitySelectors.all()) {
      const padding = await select.evaluate((element) => ({
        top: getComputedStyle(element).paddingTop,
        bottom: getComputedStyle(element).paddingBottom,
      }));
      expect(padding.top).toBe(padding.bottom);
    }
    const map = page.getByRole("group", { name: "Playable locations map" });
    await map.scrollIntoViewIfNeeded();
    const markers = map.locator(".worldMapMarker");
    expect(await markers.count()).toBeGreaterThan(0);
    const minimum = testInfo.project.use.hasTouch ? 44 : 40;
    for (const marker of await markers.all()) {
      const box = (await marker.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(minimum);
      expect(box.height).toBeGreaterThanOrEqual(minimum);
    }
    const cluster = map.locator(".worldMapMarker.cluster").first();
    const colors = await cluster.evaluate((element) => ({
      color: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
    }));
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(colors.color);
    const background = luminance(colors.background);
    expect(
      (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
    if (process.env.PR_SCREENSHOTS)
      await page.screenshot({ path: testInfo.outputPath(`map-${theme}.png`) });
  });
}
