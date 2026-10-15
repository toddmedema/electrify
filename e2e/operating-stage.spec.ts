import { expect, test } from "./fixtures";

const layouts = [
  { width: 1440, height: 900 },
  { width: 3440, height: 1440 },
  { width: 1024, height: 768 },
  { width: 1024, height: 600 },
  { width: 844, height: 690 },
];

for (const viewport of layouts) {
  for (const theme of ["light", "dark"]) {
    test(`operating stage keeps context at ${viewport.width}x${viewport.height} in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((mode) => {
        localStorage.clear();
        localStorage.setItem("theme", mode);
      }, theme);
      await page.goto("/?scenario=103");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const stage = page.getByRole("region", {
        name: "Live grid",
        exact: true,
      });
      await expect(stage).toBeVisible();
      await expect(stage.locator(".uplot")).toBeVisible();
      await expect(page.locator("#chartSupplyDemand")).toHaveCount(1);
      const insights = page.locator(".insights");
      await expect(insights).toBeVisible();
      await insights.evaluate((element) =>
        element.setAttribute("data-stage-probe", "same"),
      );
      const zoom = insights.getByRole("button", {
        name: "Zoom in",
        exact: true,
      });
      await zoom.click();
      const range = await insights
        .locator(".insightsViewportDate")
        .textContent();
      await page.locator(".facilityDisclosure").first().click();
      const selected = stage.getByRole("region", {
        name: "Selected facility controls",
      });
      await expect(selected).toBeVisible();
      const selectedName = await selected.locator("strong").textContent();
      await selected
        .getByRole("button", { name: "Pause", exact: true })
        .click();
      await expect(selected).toContainText("Paused");
      await selected
        .getByRole("button", { name: "Resume", exact: true })
        .click();

      const build = page.locator(".button-buildFacility");
      await build.click();
      const catalog = page.locator(".operatingStageBuild");
      await expect(catalog).toBeVisible();
      await expect(stage).toBeVisible();
      await expect(stage.locator(".uplot")).toBeVisible();
      await expect(page.locator(".facilities")).toBeVisible();
      await expect(insights).toHaveAttribute("data-stage-probe", "same");
      await expect(insights).toBeHidden();
      await expect(selected).toContainText(selectedName!);
      expect(
        (await stage.locator(".uplot").boundingBox())!.y +
          (await stage.locator(".uplot").boundingBox())!.height,
      ).toBeLessThanOrEqual((await selected.boundingBox())!.y + 1);
      await expect(page.locator("#speedChangeButtons")).toHaveCount(1);
      await expect(
        catalog.getByRole("tab", { name: "Storage", exact: true }),
      ).toBeVisible();
      await catalog.getByRole("tab", { name: "Storage", exact: true }).click();
      await expect(catalog.locator(".buildOption").first()).toBeVisible();
      await catalog
        .getByRole("tab", { name: "Generators", exact: true })
        .click();
      const review = catalog
        .getByRole("button", { name: /Review purchase of/ })
        .first();
      await review.scrollIntoViewIfNeeded();
      await expect(review).toBeInViewport({ ratio: 0.99 });
      expect(
        await page
          .locator("main.base_main")
          .evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`stage-build-${viewport.width}-${theme}.png`),
        animations: "disabled",
      });
      const image = stage.getByRole("img");
      await image.focus();
      await image.press("Home");
      await expect(stage.locator(".chartTooltip")).toBeVisible();
      await image.press("Escape");
      await expect(stage.locator(".chartTooltip")).toBeHidden();
      await expect(catalog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(catalog).toHaveCount(0);
      await expect(insights).toBeVisible();
      await expect(insights).toHaveAttribute("data-stage-probe", "same");
      await expect(insights.locator(".insightsViewportDate")).toHaveText(
        range!,
      );
      await expect(build).toBeFocused();
      await page.keyboard.press("g");
      await expect(catalog).toBeVisible();
      await page.goBack();
      await expect(catalog).toHaveCount(0);
      await expect(stage).toBeVisible();
    });
  }
}

test("phone keeps its full-screen catalog", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("theme", "light");
  });
  await page.goto("/?scenario=103");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Live grid", exact: true }),
  ).toHaveCount(0);
  await page.locator(".button-buildFacility").click();
  await expect(page.locator(".buildOption").first()).toBeVisible();
  await expect(page.locator(".operatingStageBuild")).toHaveCount(0);
  await expect(page.locator("#speedChangeButtons")).toHaveCount(1);
  await page.locator("#close-button").click();
  await expect(page.locator("main.base_main")).toHaveCount(1);
  await expect(page.locator(".facilities")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("phone-operating-light.png"),
    animations: "disabled",
  });
});

test("large text reserves a useful primary context on a short tablet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/?scenario=108");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const stage = page.getByRole("region", { name: "Live grid", exact: true });
  await expect(stage).toBeVisible();
  // Exercise the shared text/control contract without depending on another feature's settings.
  await page.addStyleTag({
    content: `html {font-size:24px;--control-size:66px}
    .MuiButton-root,.MuiIconButton-root,.MuiInputBase-root {min-height:66px!important}
    #topbar .MuiToolbar-root {min-height:66px!important} .gameStatusBar {min-height:68px}
    .pane-layout #navfooter {height:84px;min-height:84px;flex:0 0 84px}`,
  });
  await page.locator(".facilityDisclosure").first().click();
  await page.locator(".button-buildFacility").click();
  await expect(page.locator(".operatingWorkspace")).toHaveAttribute(
    "data-mini",
    "true",
  );
  await expect(stage.locator(".operatingStageInlineSelection")).toBeVisible();
  const catalog = page.locator(".operatingStageBuild");
  const review = catalog
    .getByRole("button", { name: /Review purchase of/ })
    .first();
  await review.scrollIntoViewIfNeeded();
  await expect(review).toBeInViewport({ ratio: 0.99 });
  await review.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "close", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(catalog).toHaveCount(0);
  expect(
    (await page.locator(".operatingStageContext:not([hidden])").boundingBox())!
      .height,
  ).toBeGreaterThanOrEqual(240);
});
