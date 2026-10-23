import { expect, test } from "./fixtures";
import { readSavedGame } from "./save-fixture";

test("custom scenario events compose and persist without overflowing setup", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [{ scenarioId: 0, timesPlayed: 1, date: new Date().toString() }],
      }),
    );
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await page.getByRole("button", { name: "View Custom Game details" }).click();
  await expect(
    page.getByRole("heading", { name: "Custom setup" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: /^Electricity rate/i }),
  ).toHaveCount(0);
  const outlook = page.getByRole("region", { name: "Year 1 outlook" });
  await expect(outlook).toContainText("Demand covered", { timeout: 30000 });
  const events = page.getByRole("combobox", {
    name: "Scenario events",
    exact: true,
  });
  await events.click();
  await expect(
    page.getByRole("option", { name: "Wildfire Emergency", exact: true }),
  ).toHaveCount(0);
  for (const name of [
    "Data Center Boom",
    "Heatwave + Drought",
    "Sudden Nuclear Shutdown",
  ]) {
    const option = page.getByRole("option", { name, exact: true });
    await option.click();
    await expect(option).toHaveAttribute("aria-selected", "true");
  }
  await page.keyboard.press("Escape");
  await expect(events).toContainText("Data Center Boom");
  await expect(events).toContainText("Sudden Nuclear Shutdown");
  await expect(outlook).toContainText("Demand covered", { timeout: 30000 });
  expect(
    await events.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await page
      .locator(".customSetupSettings")
      .evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await page
      .locator("main.base_main")
      .evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.locator(".customSetupColumns").screenshot({
    path: testInfo.outputPath("custom-events.png"),
  });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("#appbar:visible").first()).toBeVisible({
    timeout: 30000,
  });
  await expect
    .poll(
      async () => (await readSavedGame(page))?.customScenario?.eventScenarioIds,
    )
    .toEqual([106, 108, 110]);
  const scenario = (await readSavedGame(page))!.customScenario!;
  expect(
    scenario.loadAdditions!.some(
      (load: { label: string }) => load.label === "Data Centers",
    ),
  ).toBe(true);
  await page
    .locator("#navfooter:visible")
    .getByRole("button", { name: "Scenario", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "Scenario", exact: true }),
  ).not.toContainText("Meaningful decisions");
  await expect(
    page.getByRole("region", { name: "Scenario", exact: true }),
  ).not.toContainText("decisions across");
});
