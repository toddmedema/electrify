import { expect, test } from "@playwright/test";

test("paused insights refresh customer programs and keep chart zoom after a palette change", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("insightsLayers", JSON.stringify(["supplyDemand"]));
  });
  await page.goto("/?scenario=106");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const insights = page.locator(".insights:visible");
  if (!(await insights.isVisible()))
    await page.getByRole("button", { name: "Insights", exact: true }).click();
  const chart = insights.locator(".accessibleChart [role=img]").first();
  const before = await chart.getAttribute("aria-label");
  await insights
    .getByRole("button", { name: "Customer programs", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Efficiency.*Off/i }).click();
  await dialog.getByRole("radio", { name: /^Large/ }).check();
  await dialog.getByRole("button", { name: "Start next month" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(chart).not.toHaveAttribute("aria-label", before!);
  const span = async () =>
    Number(await chart.getAttribute("data-viewport-max")) -
    Number(await chart.getAttribute("data-viewport-min"));
  const zoom = async () => {
    const initialSpan = await span();
    await chart.locator(".u-over").hover();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    await expect.poll(span).toBeLessThan(initialSpan);
  };
  await zoom();
  const zoomedSpan = await span();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await span()).toBe(zoomedSpan);
  await zoom();
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: testInfo.outputPath("insights-program-zoom-dark.png"),
  });
});
