import { expect, test } from "./fixtures";

test("keeps the HUD bounded and reflows saved interface sizes across displays", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== "desktop-chromium");
  await page.setViewportSize({ width: 3440, height: 1440 });
  await page.addInitScript(() => {
    if (!localStorage.getItem("hud-test-initialized")) {
      localStorage.clear();
      localStorage.setItem("theme", "light");
      localStorage.setItem("hud-test-initialized", "true");
    }
  });
  await page.goto("/?scenario=103");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator(".desktop-panes")).toBeVisible();
  await page.keyboard.press("0");
  const frame = page.locator(".hud-frame");
  const initial = await frame.boundingBox();
  expect(initial!.width).toBeLessThanOrEqual(2000);
  expect(initial!.x).toBeCloseTo((3440 - initial!.width) / 2, 0);
  const widths = await page
    .locator(".desktop-pane")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().width),
    );
  expect(widths[0]).toBeLessThanOrEqual(480.1);
  expect(widths[2]).toBeLessThanOrEqual(360.1);

  // Both keyboard and pointer resizing retain the side-panel limits.
  const splitter = page.getByRole("separator").first();
  const before = widths[0];
  await splitter.focus();
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(
      async () =>
        (await page.locator(".desktop-pane").first().boundingBox())!.width,
    )
    .toBeLessThan(before);
  const handle = (await splitter.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 120,
    handle.y + handle.height / 2,
  );
  await page.mouse.up();
  expect(
    (await page.locator(".desktop-pane").first().boundingBox())!.width,
  ).toBeLessThanOrEqual(480.1);
  await splitter.dblclick();
  await splitter.evaluate((element) => (element as HTMLElement).blur());
  await page.mouse.move(4, 4);
  await expect(page.getByText(/Calculating forecast/)).toHaveCount(0);
  await expect(page.locator(".insights canvas").first()).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("hud-ultrawide-light.png"),
    animations: "disabled",
  });

  await page.getByRole("button", { name: "menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "150%", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-scale",
    "1.5",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("interfaceScale")),
  ).toBe("1.5");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".desktop-panes")).toHaveCount(1);

  for (const viewport of [
    { width: 1024, height: 900 },
    { width: 1440, height: 900 },
    { width: 2560, height: 1440 },
    { width: 3440, height: 1440 },
    { width: 3840, height: 2160 },
    { width: 844, height: 690 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".desktop-pane")).toHaveCount(
      viewport.width >= 1950 ? 3 : 2,
    );
    await expect(page.locator(".cardTransitions > main")).toHaveCount(1);
    await expect(frame).toBeVisible();
    expect((await frame.boundingBox())!.width).toBeLessThanOrEqual(
      Math.min(viewport.width, 3000),
    );
    const overflow = await page
      .locator(".desktop-pane")
      .evaluateAll((elements) =>
        elements.map((element) => element.scrollWidth - element.clientWidth),
      );
    expect(overflow.every((amount) => amount <= 1)).toBe(true);
    await expect(page.locator(".pane-layout #navfooter")).toHaveCount(
      viewport.width >= 1950 ? 0 : 1,
    );
    if (viewport.width === 2560) {
      await expect(page.getByText(/Calculating forecast/)).toHaveCount(0);
      await expect(page.locator(".insights canvas").first()).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("hud-large-dark.png"),
        animations: "disabled",
      });
      expect(
        await page
          .locator(".facilityName")
          .first()
          .evaluate((element) =>
            parseFloat(getComputedStyle(element).fontSize),
          ),
      ).toBeGreaterThanOrEqual(20);
      expect(
        (await page
          .locator(".facilityRowIcon .MuiAvatar-root")
          .first()
          .boundingBox())!.width,
      ).toBeCloseTo(60, 0);
      const icon = (await page
        .locator(".facilityRowIcon .MuiAvatar-root")
        .first()
        .boundingBox())!;
      const name = (await page.locator(".facilityName").first().boundingBox())!;
      expect(name.x).toBeGreaterThanOrEqual(icon.x + icon.width + 4);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-scale",
    "1",
  );
  await expect(page.locator(".hud-frame")).toHaveCount(0);
  await expect(page.locator(".cardTransitions > main")).toHaveCount(1);
  await expect(page.locator("#navfooter")).toBeVisible();
  expect(
    await page
      .locator("html")
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBe(16);
  await page.screenshot({
    path: testInfo.outputPath("hud-phone-dark.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("group", { name: "Interface size" })).toHaveCount(
    0,
  );

  // Reload restores the preference; returning to a large viewport applies it again.
  await page.reload();
  await page.setViewportSize({ width: 2560, height: 1440 });
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-scale",
    "1.5",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("interfaceScale")),
  ).toBe("1.5");
});
