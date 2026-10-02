import { expect, test, type Locator } from "@playwright/test";
import { openPane } from "./layout";
import { readSavedGame } from "./save-fixture";

async function baselinePixels(chart: Locator) {
  return chart.evaluate((element) => {
    const canvas = element.querySelector("canvas")!;
    const plot = element.querySelector(".u-over")!.getBoundingClientRect();
    const bounds = canvas.getBoundingClientRect();
    const scale = canvas.width / bounds.width;
    const x = Math.round((plot.left - bounds.left) * scale) + 8;
    const y = Math.round((plot.bottom - bounds.top) * scale);
    const width = Math.round(plot.width * scale) - 16;
    const pixels = canvas.getContext("2d")!.getImageData(x, y, width, 1).data;
    const colors = Array.from({ length: width }, (_, i) =>
      Array.from(pixels.slice(i * 4, i * 4 + 4)).join(","),
    );
    const counts = new Map<string, number>();
    colors.forEach((color) => counts.set(color, (counts.get(color) || 0) + 1));
    const dominant = [...counts].sort((a, b) => b[1] - a[1])[0];
    return { color: dominant[0], share: dominant[1] / width };
  });
}

for (const theme of ["light", "dark"]) {
  test(`facilities baseline stays solid through half a month in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=106");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await openPane(page.locator(".facilities"), page.locator("#faciltiesNav"));
    const chart = page.locator("#chartSupplyDemand");
    await expect(chart.locator("canvas")).toBeVisible();
    const before = await baselinePixels(chart);
    expect(before.share).toBeGreaterThan(0.97);
    expect(before.color).not.toBe("0,0,0,0");
    await chart.screenshot({
      path: info.outputPath(`baseline-start-${theme}.png`),
    });
    await page
      .locator("#appbar:visible")
      .getByRole("button", { name: "normal speed", exact: true })
      .first()
      .click();
    await expect
      .poll(async () => (await readSavedGame(page))?.date.minute || 0, {
        timeout: 30000,
      })
      .toBeGreaterThanOrEqual(720);
    await page
      .locator("#appbar:visible")
      .getByRole("button", { name: "pause", exact: true })
      .first()
      .click();
    const after = await baselinePixels(chart);
    expect(after.share).toBeGreaterThan(0.97);
    expect(after.color).toBe(before.color);
    await chart.screenshot({
      path: info.outputPath(`baseline-half-month-${theme}.png`),
    });
  });
}
