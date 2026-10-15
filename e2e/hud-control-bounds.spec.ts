import { expect, test, Locator } from "./fixtures";

async function containedBy(control: Locator, container: Locator) {
  const inner = (await control.boundingBox())!;
  const outer = (await container.boundingBox())!;
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 0.5);
  expect(inner.x + inner.width).toBeLessThanOrEqual(
    outer.x + outer.width + 0.5,
  );
  expect(inner.y + inner.height).toBeLessThanOrEqual(
    outer.y + outer.height + 0.5,
  );
}

for (const theme of ["light", "dark"]) {
  test(`scaled chart controls and pane navigation fit their allocated surfaces in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(
      !["desktop-chromium", "foldable-unfolded"].includes(info.project.name),
    );
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("interfaceScale", "1.25");
    }, theme);
    await page.goto("/?scenario=103");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.locator(".desktop-panes")).toBeVisible();
    await page.keyboard.press("0");

    for (const scale of [1.25, 1.5]) {
      if (scale === 1.5) {
        await page.getByRole("button", { name: "menu", exact: true }).click();
        await page
          .getByRole("menuitem", { name: "Settings", exact: true })
          .click();
        await page.getByRole("button", { name: "150%", exact: true }).click();
        await page.getByRole("button", { name: "Back", exact: true }).click();
      }
      for (const viewport of [
        { width: 2560, height: 1440 },
        { width: 1440, height: 900 },
        { width: 1024, height: 900 },
        { width: 844, height: 690 },
      ]) {
        await page.setViewportSize(viewport);
        await expect(page.locator("html")).toHaveAttribute(
          "data-interface-scale",
          String(scale),
        );
        const desktop = viewport.width >= 1300 * scale;
        await expect(
          page.locator(desktop ? ".desktop-layout" : ".pane-layout"),
        ).toHaveCount(1);
        await expect(
          page.locator(desktop ? ".pane-layout" : ".desktop-layout"),
        ).toHaveCount(0);
        await expect(page.locator(".cardTransitions > main")).toHaveCount(1);
        const toolbar = page.getByRole("region", {
          name: "Chart time navigation",
        });
        await expect(toolbar).toHaveCount(1);
        await expect(toolbar).toBeVisible();
        const wrappers = toolbar.locator(".insightsViewportButton");
        const buttons = toolbar.getByRole("button");
        await expect(buttons).toHaveCount(5);
        const minimum = (info.project.use.hasTouch ? 44 : 40) * scale;
        let previousRight = 0;
        for (let i = 0; i < 5; i++) {
          const button = buttons.nth(i);
          const bounds = (await button.boundingBox())!;
          expect(bounds.width).toBeGreaterThanOrEqual(minimum - 0.5);
          expect(bounds.height).toBeGreaterThanOrEqual(minimum - 0.5);
          expect(bounds.x).toBeGreaterThanOrEqual(previousRight);
          previousRight = bounds.x + bounds.width;
          await containedBy(button, wrappers.nth(i));
          await containedBy(button, toolbar);
          await containedBy(button.locator("svg"), button);
        }
        const footer = page.locator(".pane-layout #navfooter");
        if (viewport.width < 1300 * scale) {
          await expect(footer).toBeVisible();
          const bounds = (await footer.boundingBox())!;
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(
            viewport.height + 0.5,
          );
          for (const button of await footer.getByRole("button").all()) {
            await containedBy(button, footer);
            await containedBy(
              button.locator(".MuiBottomNavigationAction-label"),
              button,
            );
            await containedBy(button.locator("svg"), button);
          }
          await footer
            .getByRole("button", { name: "Events", exact: true })
            .click();
          await expect(page.locator(".eventLog:visible")).toBeVisible();
          await footer
            .getByRole("button", { name: "Insights", exact: true })
            .click();
          await expect(toolbar).toBeVisible();
        }
        if (scale === 1.5 && viewport.width === 844) {
          await page.mouse.move(4, 4);
          await expect(page.getByText(/Calculating forecast/)).toHaveCount(0);
          await page.screenshot({
            path: info.outputPath(
              `hud-controls-${theme}-${info.project.use.hasTouch ? "coarse" : "mouse"}.png`,
            ),
            animations: "disabled",
          });
        }
      }
    }

    // Saved tablet size must not change the phone's original 56px navigation allocation.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("html")).toHaveAttribute(
      "data-interface-scale",
      "1",
    );
    await expect(page.locator(".cardTransitions > main")).toHaveCount(1);
    const footer = page.locator("#navfooter");
    await expect(page.locator(".desktop-panes")).toHaveCount(0);
    await expect(footer).toHaveCount(1);
    expect((await footer.boundingBox())!.height).toBeCloseTo(57, 0);
    for (const label of await footer
      .locator(".MuiBottomNavigationAction-label")
      .all()) {
      await containedBy(label, footer);
    }
  });
}
