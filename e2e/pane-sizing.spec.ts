import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`pane minimums and compact controls follow actual width in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop-chromium");
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem(
        "desktopPaneWeightsInsights",
        JSON.stringify([100, 1, 1]),
      );
      localStorage.setItem(
        "desktopPaneWeightsInsights2",
        JSON.stringify([100, 1]),
      );
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    for (const width of [1024, 1100, 1440, 1920, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      // A pane-count breakpoint keeps the outgoing layout mounted during its exit.
      // Interact only with the settled layout, not a menu that is about to unmount.
      await expect(page.locator(".cardTransitions > main")).toHaveCount(1);
      const panes = page
        .locator(".desktop-panes:visible")
        .last()
        .locator(":scope > .desktop-pane");
      await expect(panes.first()).toBeVisible();
      await expect
        .poll(async () =>
          (
            await panes.evaluateAll((els) =>
              els.map((el) => el.getBoundingClientRect().width),
            )
          ).every((value) => value >= 239.9),
        )
        .toBe(true);
      const insights = page.locator(".insights:visible").last();
      await expect(insights).toHaveClass(/insightsCompact/);
      const controls = insights.locator(".insightsHeaderControls");
      expect(
        await controls.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      await insights.getByRole("button", { name: "Preset actions" }).click();
      await expect(
        page.locator(".insightsPresetSaveMenuItem:visible"),
      ).toHaveCount(1);
      await expect(
        page.getByRole("menuitem", { name: "Save as new preset", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Preset actions" }).click();
    await page
      .getByRole("menuitem", { name: "Save as new preset", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const handle = page.getByRole("separator").first();
    await handle.focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
    await handle.dblclick();
    expect(
      await page
        .locator(".desktop-pane:visible")
        .evaluateAll((els) =>
          els.every((el) => el.getBoundingClientRect().width >= 239.9),
        ),
    ).toBe(true);
  });
}
