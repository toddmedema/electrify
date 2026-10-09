import { expect, Page, test } from "./fixtures";

async function seed(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript((mode) => {
    if (!localStorage.getItem("display-test-seeded")) {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("display-test-seeded", "true");
    }
  }, theme);
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function readablePhoneStatus(page: Page) {
  await expect(page.locator(".missionGoalPhone")).toHaveText(
    /Customers [\d,]+ \/ ≥[\d,]+/,
  );
  await expect(page.locator(".missionMonthsPhone")).toHaveText("240 mo");
  await expect(page.locator(".gridHealthTime")).toHaveText("Now");
  await expect(page.locator(".gridHealthState")).toContainText("Stable");
  const textBounds = await page.locator("#appbar").evaluate((bar) => {
    const selectors =
      ".gameStatusValue, .gridHealthState, .gridHealthMetric, .missionSummaryHeadline:not(:has(.missionGoalPhone)), .missionGoalPhone, .missionRiskText, .missionSummaryMonths:not(:has(.missionMonthsPhone)), .missionMonthsPhone";
    return Array.from(bar.querySelectorAll<HTMLElement>(selectors)).flatMap(
      (element) => {
        const box = element.getBoundingClientRect();
        if (
          getComputedStyle(element).display === "none" ||
          box.width <= 1 ||
          box.height <= 1
        )
          return [];
        const range = document.createRange();
        range.selectNodeContents(element);
        const outside = Array.from(range.getClientRects()).some(
          (text) =>
            text.left < box.left - 1 ||
            text.right > box.right + 1 ||
            text.top < bar.getBoundingClientRect().top - 1 ||
            text.bottom > bar.getBoundingClientRect().bottom + 1,
        );
        return [{ label: element.textContent, outside }];
      },
    );
  });
  expect(textBounds.length).toBeGreaterThanOrEqual(5);
  expect(textBounds.filter((text) => text.outside)).toEqual([]);
  for (const name of ["pause", "slow speed", "normal speed", "fast speed"]) {
    const control = page.getByRole("button", { name, exact: true });
    await expect(control).toBeInViewport({ ratio: 0.99 });
    const bounds = await control.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(48);
    expect(bounds!.width).toBeGreaterThanOrEqual(48);
  }
  const detail = page.getByRole("button", {
    name: "All requirements",
    exact: true,
  });
  expect((await detail.boundingBox())!.height).toBeGreaterThanOrEqual(48);
}

for (const theme of ["light", "dark"] as const) {
  test(`larger display reflows, persists and keeps play usable in ${theme}`, async ({
    page,
  }, testInfo) => {
    await seed(page, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Larger", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("button", { name: "Larger", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute(
      "data-interface-size",
      "larger",
    );
    expect(
      await page
        .locator("html")
        .evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe("20px");
    expect(
      (await page
        .getByRole("button", { name: "Larger", exact: true })
        .boundingBox())!.height,
    ).toBeGreaterThanOrEqual(48);
    await noOverflow(page);
    await page.evaluate(() => document.fonts.ready);
    if (process.env.DISPLAY_SCREENSHOTS && theme === "light") {
      await page.screenshot({
        path: `${process.env.DISPLAY_SCREENSHOTS}/${testInfo.project.name === "mobile-390px" ? "pr-display-phone" : "pr-display-settings"}.png`,
      });
    }
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Larger", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goto("/?scenario=103");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.locator("#appbar")).toBeVisible();
    await noOverflow(page);
    await expect(
      page.getByRole("button", { name: "pause", exact: true }),
    ).toBeInViewport();
    const phone = testInfo.project.name === "mobile-390px";
    if (phone) {
      await readablePhoneStatus(page);
      if (process.env.DISPLAY_SCREENSHOTS && theme === "light") {
        await page.screenshot({
          path: `${process.env.DISPLAY_SCREENSHOTS}/pr-display-phone.png`,
          animations: "disabled",
        });
      }
    }
    await expect(page.locator("html")).toHaveAttribute(
      "data-pane-layout",
      String(!phone),
    );
    await page
      .getByRole("button", { name: "normal speed", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("menuitem", { name: "Resume game", exact: true }),
    ).toBeFocused();
    await expect(
      page.locator('.speedToggles [aria-label="pause"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "normal speed", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "menu", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "normal speed", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "pause", exact: true }).click();
    if (process.env.DISPLAY_SCREENSHOTS && theme === "dark" && !phone) {
      await page.keyboard.press("Escape");
      // Capture the completed pause menu, including its bundled font, after the opening transition.
      await page.locator(".MuiMenu-paper").evaluate(async (menu) => {
        await Promise.all(
          menu.getAnimations().map((animation) => animation.finished),
        );
      });
      await page.screenshot({
        path: `${process.env.DISPLAY_SCREENSHOTS}/pr-display-game.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
    }
    // A viewport narrower than the enlarged two-pane threshold must bring back one primary pane.
    if (!phone) {
      await page.setViewportSize({ width: 1100, height: 800 });
      await expect(page.locator("html")).toHaveAttribute(
        "data-pane-layout",
        "false",
      );
      await expect(
        page.getByRole("button", { name: "Insights", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Insights", exact: true }).click();
      await expect(page.locator(".cardTransitions > main")).toHaveCount(1);
      const track = page.locator(
        '.insights:visible .insightsTrack[data-layer="supplyDemand"]',
      );
      await track.locator(".u-over").hover();
      const plot = await track.locator(".u-over").boundingBox();
      // The crosshair still follows the pointer after natural text sizing and reflow.
      const cursor = track.locator(".u-cursor-x");
      await expect(cursor).toBeVisible();
      expect((await cursor.boundingBox())!.x).toBeCloseTo(
        plot!.x + plot!.width / 2,
        -1,
      );
      await noOverflow(page);
    }
  });
}

test("fullscreen enters, exits and follows a real browser session", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  await seed(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const enabled = await page.evaluate(() => document.fullscreenEnabled);
  test.skip(!enabled, "Fullscreen API unavailable in this browser host");
  await page
    .getByRole("button", { name: "Enter fullscreen", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Exit fullscreen", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Exit fullscreen", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  await expect(
    page.getByRole("button", { name: "Enter fullscreen", exact: true }),
  ).toBeEnabled();
});

test("invalid saved sizing falls back to Normal", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("interfaceSize", "1000"));
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Normal", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
