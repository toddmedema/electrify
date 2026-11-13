import fs from "node:fs/promises";
import path from "node:path";
import { expect, Page, test } from "./fixtures";
import { openBuild, openPane } from "./layout";
import { MARKETING_SCENES } from "./marketing-scenes";
import { readShotRequest } from "./shot-request";

async function openTool(page: Page, name: string) {
  const pane = page.getByRole("region", { name, exact: true });
  await openPane(pane, page.getByRole("button", { name, exact: true }));
  return pane;
}

// Deliberately not a *.spec.ts: exporting marketing assets is an explicit operation.
test("capture marketing scene", async ({ page }, info) => {
  const scene = MARKETING_SCENES.find(
    ({ name }) => name === info.project.name,
  )!;
  const file = path.join(readShotRequest().outDir, scene.file);
  await fs.rm(file, { force: true });
  await page.addInitScript(({ theme }) => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem("units", "metric");
  }, scene);
  await page.goto(`/?scenario=${scene.scenario}`);
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(
    page.getByText("Starting your mission…", { exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".facilities .facilityRow").first()).toBeVisible();

  if (scene.view === "overview" || scene.view === "reliability") {
    await openTool(page, "Insights");
    if (scene.view === "reliability") {
      await page
        .getByRole("combobox", { name: "Insight preset", exact: true })
        .click();
      await page
        .getByRole("option", { name: "Reliability", exact: true })
        .click();
    }
    await expect(
      page.locator("#chartForecastSupplyDemand canvas"),
    ).toBeVisible();
  } else if (scene.view === "generators" || scene.view === "storage") {
    const build = await openBuild(page);
    await build
      .getByRole("tab", {
        name: scene.view === "storage" ? "Storage" : "Generators",
        exact: true,
      })
      .click();
    await expect(build.locator(".buildOption").first()).toBeVisible();
  } else if (scene.view === "programs") {
    await openTool(page, "Programs");
    await expect(page.locator("#rateSlider input")).toBeVisible();
  } else {
    const build = await openBuild(page);
    await build.getByRole("tab", { name: "Interties", exact: true }).click();
    await expect(
      build
        .getByRole("button", { name: /Review purchase of.*intertie/ })
        .first(),
    ).toBeVisible();
  }
  await page.mouse.move(0, 0);
  // Wait for real fonts, chart workers and tool transitions before recording the UI.
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".MuiCircularProgress-root")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.locator("#appbar .gridHealth:visible")).toHaveClass(
    /gridHealth-stable/,
  );
  await expect(
    page.locator(
      "#appbar .statusWarning:visible, #appbar .blackout-pulsing:visible",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Generator comparison" }),
  ).toHaveCount(0);
  await expect(page.locator(".gameToolPanel:visible")).toHaveCount(1);
  if (scene.view === "overview" || scene.view === "reliability") {
    await expect(page.locator("#insightsPreset")).toHaveText(
      scene.view === "reliability" ? "Reliability" : "Overview",
    );
    await expect(
      page.getByRole("status", { name: "Unsaved changes" }),
    ).toHaveCount(0);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const png = await page.screenshot({ animations: "disabled" });
  const scale = info.project.use.deviceScaleFactor ?? 1;
  const width = Math.round(scene.viewport.width * scale);
  const height = Math.round(scene.viewport.height * scale);
  expect(png.readUInt32BE(16)).toBe(width);
  expect(png.readUInt32BE(20)).toBe(height);
  await fs.writeFile(file, png);
  console.log(
    `${file}  ${width}x${height}  ${Math.round(png.length / 1024)} KB`,
  );
});
