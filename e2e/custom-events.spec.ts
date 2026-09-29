import { expect, test } from "@playwright/test";

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
  for (const name of [
    "Data Center Boom",
    "Heatwave + Drought",
    "Wildfire Emergency",
  ]) {
    const option = page.getByRole("option", { name, exact: true });
    await option.click();
    await expect(option).toHaveAttribute("aria-selected", "true");
  }
  await page.keyboard.press("Escape");
  await expect(events).toContainText("Data Center Boom");
  await expect(events).toContainText("Wildfire Emergency");
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
    .poll(() =>
      page.evaluate(() => {
        window.dispatchEvent(new Event("pagehide"));
        const save = localStorage.getItem("savedGame");
        return save
          ? JSON.parse(save).game.customScenario?.eventScenarioIds
          : undefined;
      }),
    )
    .toEqual([106, 108, 111]);
  const scenario = await page.evaluate(
    () => JSON.parse(localStorage.getItem("savedGame")!).game.customScenario,
  );
  expect(
    scenario.loadAdditions.some(
      (load: { label: string }) => load.label === "Data Centers",
    ),
  ).toBe(true);
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "All requirements" })
    .first()
    .click();
  await expect(page.getByRole("dialog")).not.toContainText(
    "Meaningful decisions",
  );
  await expect(page.getByRole("dialog")).not.toContainText("decisions across");
});
