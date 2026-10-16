import { expect, Page, test } from "./fixtures";
import path from "path";

async function expectPageLayout(page: Page, title: string) {
  const frame = page.locator(".base_main:not([inert]) > .screenPage");
  await expect(frame.locator(".screenHeaderTitle")).toHaveText(title);
  const header = frame.locator(".screenHeader");
  const toolbar = header.locator(".screenHeaderBar");
  const bounds = (await frame.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.width).toBeCloseTo(Math.min(viewport.width, 1400), 0);
  expect(bounds.x).toBeCloseTo((viewport.width - bounds.width) / 2, 0);
  for (const element of [header, toolbar]) {
    const box = (await element.boundingBox())!;
    expect(box.x).toBeCloseTo(bounds.x, 0);
    expect(box.width).toBeCloseTo(bounds.width, 0);
  }
  const surfaces = await frame.evaluate((element) => {
    const background = (node: Element): string => {
      const color = getComputedStyle(node).backgroundColor;
      return color === "rgba(0, 0, 0, 0)" && node.parentElement
        ? background(node.parentElement)
        : color;
    };
    return {
      page: background(element),
      header: background(element.querySelector(".screenHeader")!),
      body: background(element.querySelector(".scrollable")!),
      gutter: background(document.body),
      overflow: element.scrollWidth - element.clientWidth,
    };
  });
  expect(surfaces.header).toBe(surfaces.page);
  expect(surfaces.body).toBe(surfaces.page);
  expect(surfaces.gutter).toBe(surfaces.page);
  expect(surfaces.overflow).toBeLessThanOrEqual(1);
}

async function captureReview(page: Page, filename: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(process.env.REVIEW_SCREENSHOT_DIR!, filename),
    animations: "disabled",
  });
}

for (const theme of ["light", "dark"] as const) {
  test(
    "menu pages share the Game details frame in " + theme,
    async ({ page }, testInfo) => {
      test.skip(
        !["desktop-chromium", "mobile-390px", "mobile-320px"].includes(
          testInfo.project.name,
        ),
      );
      if (testInfo.project.name === "desktop-chromium")
        await page.setViewportSize({ width: 1920, height: 1080 });
      await page.addInitScript((mode) => {
        localStorage.clear();
        localStorage.setItem("theme", mode);
        localStorage.setItem("audioEnabled", "false");
        localStorage.setItem(
          "plays",
          JSON.stringify({
            plays: [
              { scenarioId: 0, timesPlayed: 1, date: new Date().toString() },
            ],
          }),
        );
      }, theme);
      const screenshots = process.env.REVIEW_SCREENSHOT_DIR;
      const back = async () => {
        await expect(page.locator(".screenPage")).toHaveCount(1);
        await page.getByRole("button", { name: "Back", exact: true }).click();
      };
      await page.goto("/");
      await page
        .getByRole("button", { name: "Start playing", exact: true })
        .click();
      await expectPageLayout(page, "Choose a game");
      if (
        screenshots &&
        theme === "dark" &&
        testInfo.project.name === "desktop-chromium"
      )
        await captureReview(page, "pr-menu-dark-desktop.png");
      await page
        .getByRole("button", { name: "View Custom Game details" })
        .click();
      await expectPageLayout(page, "Custom setup");
      await expect(
        page.getByRole("combobox", {
          name: "Search playable cities",
          exact: true,
        }),
      ).not.toBeDisabled();
      if (
        screenshots &&
        ((theme === "light" && testInfo.project.name === "desktop-chromium") ||
          (theme === "dark" && testInfo.project.name === "mobile-390px"))
      ) {
        await expect(page.locator(".customSetupOutlook-ready")).toBeVisible({
          timeout: 60000,
        });
        await captureReview(
          page,
          "pr-custom-" + theme + "-" + testInfo.project.name + ".png",
        );
      }
      await back();
      await expectPageLayout(page, "Choose a game");
      await page
        .getByRole("button", { name: "View Deep Freeze details" })
        .click();
      await expectPageLayout(page, "Game details");
      await back();
      await back();
      for (const title of ["Settings", "Manual"]) {
        await page.getByRole("button", { name: title, exact: true }).click();
        await expectPageLayout(page, title);
        await back();
      }
      await page.goto("/?scenario=100");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await expect(page.locator("#appbar:visible")).toBeVisible();
      await page.getByRole("button", { name: "menu", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "Saved games", exact: true })
        .click();
      await expectPageLayout(page, "Saved games");
      await page.goto("/?dataCenters=1");
      await expectPageLayout(page, "Explore data center growth");
    },
  );
}
