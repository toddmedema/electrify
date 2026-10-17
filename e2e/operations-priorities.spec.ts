import { expect, test } from "./fixtures";

for (const layout of [
  { width: 1024, height: 800, theme: "light", pane: true },
  { width: 1440, height: 1000, theme: "dark", pane: true },
  { width: 3440, height: 1440, theme: "light", pane: true },
  { width: 844, height: 690, theme: "dark", pane: true },
  { width: 390, height: 844, theme: "light", pane: false },
]) {
  test(`operations priorities at ${layout.width}px in ${layout.theme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((theme) => {
      localStorage.clear();
      localStorage.setItem("theme", theme);
    }, layout.theme);
    await page.goto("/?scenario=106");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    if (layout.width < 1300)
      await page.getByRole("button", { name: "Events", exact: true }).click();
    if (layout.pane) {
      await expect(
        page.getByRole("heading", { name: "Pinned goals" }),
      ).toBeVisible();
      await expect(page.locator(".operationsGoal")).toHaveCount(2);
      await page.locator(".eventHistory").scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("button", { name: "Filter event history, All events" }),
      ).toBeVisible();
      const goals = page.getByRole("button", { name: "Choose pinned goals" });
      await goals.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menuitemcheckbox").first()).toBeVisible();
      const minimum = await page.evaluate(() =>
        Math.max(
          matchMedia("(pointer: coarse)").matches ? 44 : 40,
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--control-size",
            ),
          ) || 40,
        ),
      );
      for (const item of await page
        .getByRole("menu", { name: "Pinned goals" })
        .locator(".MuiMenuItem-root")
        .all()) {
        expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(
          minimum,
        );
      }
      await page.keyboard.press("Escape");
      await expect(goals).toBeFocused();
      for (const row of await page
        .locator(".operationsPriorities .operationsRow, .operationsGoal")
        .all()) {
        expect(
          await row.evaluate((el) => el.scrollWidth - el.clientWidth),
        ).toBeLessThanOrEqual(1);
      }
      await expect(
        page.getByRole("button", { name: /Keep the utility solvent/ }),
      ).toBeVisible();
      await expect(page.getByText(/^Calculating forecast/)).toHaveCount(0, {
        timeout: 45000,
      });
      if (layout.width >= 1300)
        await expect(page.locator('[data-layer="supplyDemand"]')).toBeVisible({
          timeout: 45000,
        });
      await page.getByRole("heading", { name: "Pinned goals" }).click();
      await page.screenshot({
        path: testInfo.outputPath(
          `operations-${layout.width}-${layout.theme}.png`,
        ),
      });
      await page
        .getByRole("button", { name: /Keep the utility solvent/ })
        .click();
      await expect(page.locator('[data-layer="financeDetails"]')).toBeVisible();
    } else {
      await expect(page.locator(".operationsPriorities")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Filter event history, All events" }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("operations-phone-unchanged.png"),
      });
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("history stays below priorities in a short pane without duplicate upcoming events", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
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
  await page
    .getByRole("combobox", { name: "Scenario events", exact: true })
    .click();
  for (const name of [
    "Data Center Boom",
    "Heatwave + Drought",
    "Wildfire Emergency",
  ]) {
    await page.getByRole("option", { name, exact: true }).click();
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const scroller = page.locator(".operationsPane > .scrollable");
  await expect(scroller).toBeVisible();
  await scroller.evaluate((element) => {
    Object.assign((element as HTMLElement).style, {
      height: "210px",
      maxHeight: "210px",
      flex: "0 0 210px",
    });
  });
  await expect(page.locator("#operationsHistory .upcomingEvents")).toHaveCount(
    0,
  );
  await page.locator(".eventHistory").scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Filter event history, All events" }),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: testInfo.outputPath("history-short-pane.png"),
  });
});
