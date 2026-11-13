import { expect, test } from "./fixtures";
import { editSavedGame, readSavedGame } from "./save-fixture";
import { openPane } from "./layout";

for (const theme of ["light", "dark"]) {
  test(`observed cash and projected cash use distinct precision in ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem("insightsLayers", JSON.stringify(["cash"]));
    }, theme);
    await page.goto("/?scenario=106");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect
      .poll(async () => Boolean(await readSavedGame(page)))
      .toBe(true);
    await editSavedGame(page, (save) => {
      for (const tick of save.game.timeline) tick.cash = 561_952_000;
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.locator(".gameStatusValue").filter({ hasText: "$562M" }),
    ).toBeVisible();
    expect((await readSavedGame(page))!.timeline[0].cash).toBe(561_952_000);
    const insights = page.locator(".insights:visible");
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    const cash = insights.locator('[data-layer="cash"]');
    await cash.scrollIntoViewIfNeeded();
    await expect(cash.getByRole("img")).toHaveAttribute(
      "aria-label",
      /Forecast Cash: latest -?\$[1-9]/,
    );
    const summary = (await cash
      .getByRole("img")
      .getAttribute("aria-label"))!.split("Forecast Cash:")[1];
    expectMoneyPrecision(summary);
    const plot = cash.locator(".u-over");
    const bounds = await plot.boundingBox();
    expect(bounds!.width).toBeGreaterThan(100);
    await plot.hover({
      position: { x: bounds!.width / 2, y: bounds!.height / 2 },
    });
    await expect(cash.locator(".chartTooltip")).toBeVisible();
    const text = await cash.locator(".chartTooltip").innerText();
    expectMoneyPrecision(text);
  });
}

function expectMoneyPrecision(text: string) {
  const amounts = [...text.matchAll(/\$([\d,.]+)([kMBT]?)/g)];
  expect(amounts.length, text).toBeGreaterThan(0);
  for (const amount of amounts) {
    const normalized = amount[1].replace(/,/g, "");
    const significant = normalized.includes(".")
      ? normalized.replace(".", "").replace(/^0+/, "")
      : normalized.replace(/^0+|0+$/g, "");
    expect(significant.length, text).toBeLessThanOrEqual(2);
  }
}
