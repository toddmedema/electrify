import { expect, test } from "./fixtures";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`bundled typography stays readable without a font service in ${theme}`, async ({
    page,
  }) => {
    const fontRequests: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "font") fontRequests.push(request.url());
    });
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
      route.abort(),
    );
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=108");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(
      page.getByText("Starting your mission…", { exact: true }),
    ).toBeHidden();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.fonts.check("600 15px Inter")),
    ).toBe(true);
    expect(
      fontRequests.some((url) =>
        url.endsWith("/fonts/inter/InterVariable.woff2"),
      ),
    ).toBe(true);
    const origin = new URL(page.url()).origin;
    expect(fontRequests.every((url) => new URL(url).origin === origin)).toBe(
      true,
    );

    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const build = pane.getByRole("button", { name: "Build", exact: true });
    const contrast = await build.evaluate((element) => {
      const style = getComputedStyle(element);
      const luminance = (rgb: string) => {
        const channels = rgb
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map((channel) => {
            const value = Number(channel) / 255;
            return value <= 0.04045
              ? value / 12.92
              : Math.pow((value + 0.055) / 1.055, 2.4);
          });
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
      );
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await build.click();
    await page.locator(".button-buildGenerator").click();
    await expect(page.locator(".buildOption").first()).toBeVisible();
    for (const card of await page.locator(".buildOption").all()) {
      expect(
        await card.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    const metrics = page.locator(".buildOptionMetric").first();
    const type = await metrics.evaluate((element) => {
      const value = element.querySelector(".MuiTypography-body2")!;
      const label = element.querySelector(".MuiTypography-caption")!;
      return {
        value: parseFloat(getComputedStyle(value).fontSize),
        label: parseFloat(getComputedStyle(label).fontSize),
        numeric: getComputedStyle(value).fontVariantNumeric,
      };
    });
    expect(type.value).toBeGreaterThan(type.label);
    expect(type.value).toBeGreaterThanOrEqual(14);
    expect(type.numeric).toContain("tabular-nums");
  });
}
