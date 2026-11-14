import { expect, test } from "./fixtures";
import { openBuild, openPane } from "./layout";

for (const { id, symbol, theme } of [
  { id: 108, symbol: "€", theme: "light" },
  { id: 115, symbol: "₹", theme: "dark" },
]) {
  test(`scenario ${id} uses local currency for cash, prices and rates in ${theme}`, async ({
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
