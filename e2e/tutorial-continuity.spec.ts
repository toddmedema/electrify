import { expect, test } from "./fixtures";
import { startTutorialMission } from "./tutorial-fixture";

test("resizing keeps the Finances lesson waiting for its dock action", async ({
  page,
}) => {
  await startTutorialMission(page, 4);
  const hud = page.locator(".tutorialHud");
  const insights = page.getByRole("button", { name: "Insights", exact: true });
  for (const width of [390, 768, 884, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(hud).toContainText("Open Insights");
    await expect(insights).toHaveClass(/tutorialTarget/);
    await expect(insights).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".tutorialTargetRing:visible")).toHaveCount(1);
  }
  await insights.click();
  await expect(hud).toContainText("Compare revenue and costs");
  await page.getByRole("button", { name: /^Layers \(/ }).click();
  for (const name of ["Profit", "Finance details"]) {
    const layer = page.getByRole("checkbox", { name, exact: true });
    await expect(layer).toBeChecked();
    await expect(layer).toBeDisabled();
  }
});

test("Pricing preserves the chosen rate while switching to Insights and starting the challenge", async ({
  page,
}) => {
  await startTutorialMission(page, 3);
  await page.getByRole("button", { name: "Programs", exact: true }).click();
  const rate = page.locator("#rateSlider input");
  await rate.press("ArrowLeft");
  const chosenRate = await rate.inputValue();
  const hud = page.locator(".tutorialHud");
  const next = hud.getByRole("button", { name: "Next", exact: true });
  await next.click();
  for (const width of [390, 768, 884, 1280]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(page.locator("#chartInsightsCustomers")).toHaveClass(
      /tutorialTarget/,
    );
  }
  await next.click();
  await expect(hud).toContainText("Grow customers 5%");
  await page.getByRole("button", { name: "slow speed", exact: true }).click();
  await page.getByRole("button", { name: "pause", exact: true }).click();
  const programs = page.getByRole("button", { name: "Programs", exact: true });
  if ((await programs.getAttribute("aria-expanded")) !== "true")
    await programs.click();
  await expect(rate).toHaveValue(chosenRate);
});
