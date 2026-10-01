import { expect, test } from "@playwright/test";

test("About leads to data-center setup and the selected event starts in the game", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/about.html");
  await page
    .getByRole("link", { name: "Explore data centers and your grid" })
    .click();
  await expect(page).toHaveURL(/\/data-centers\.html$/);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "What could they mean for your community?",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`data-centers-${colorScheme}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("link", { name: "Explore the impact" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Custom setup" }),
  ).toBeVisible();
  const events = page.getByRole("combobox", {
    name: "Scenario events",
    exact: true,
  });
  await expect(events).toHaveText("Data Center Boom");
  await page.reload();
  await expect(events).toHaveText("Data Center Boom");
  await page.goBack();
  await expect(events).toHaveCount(0);
  await expect(page).not.toHaveURL(/customEvent/);
  await page.goForward();
  await expect(events).toHaveText("Data Center Boom");
  await events.click();
  const option = page.getByRole("option", {
    name: "Data Center Boom",
    exact: true,
  });
  await option.click();
  await expect(option).toHaveAttribute("aria-selected", "false");
  await option.click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("#appbar:visible").first()).toBeVisible({
    timeout: 30000,
  });
  await expect(page).not.toHaveURL(/customEvent/);
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
    .toEqual([106]);
  const loads = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("savedGame")!).game.customScenario
        .loadAdditions,
  );
  expect(loads).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ demandType: "Data Centers" }),
    ]),
  );
});
