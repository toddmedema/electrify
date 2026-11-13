import fs from "node:fs/promises";
import path from "node:path";
import { expect, Page, test } from "./fixtures";
import { openBuild, openPane, sortBuildCatalog } from "./layout";
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
  await page.addInitScript(({ theme, view }) => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem("units", "metric");
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(
        view === "weather" ? ["weather", "water"] : ["supplyDemand", "cash"],
      ),
    );
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

  if (scene.view === "overview" || scene.view === "weather") {
    await openTool(page, "Insights");
    await expect(
      page.locator(
        scene.view === "weather"
          ? "#chartForecastWeather canvas"
          : "#chartForecastSupplyDemand canvas",
      ),
    ).toBeVisible();
    if (scene.view === "overview" && scene.viewport.width > 1200)
      await openTool(page, "Events");
  } else if (scene.view === "generators" || scene.view === "storage") {
    const build = await openBuild(page);
    await build
      .getByRole("tab", {
        name: scene.view === "storage" ? "Storage" : "Generators",
        exact: true,
      })
      .click();
    if (scene.view === "generators") {
      await sortBuildCatalog(page, "Build cost");
      for (const name of ["Natural Gas CC", "Solar"]) {
        const card = build.locator(".buildOption").filter({
          has: page.getByRole("button", {
            name: `Review purchase of ${name}`,
            exact: true,
          }),
        });
        await card.getByRole("button", { name: /^Compare/ }).click();
      }
      await expect(
        page.getByRole("region", { name: "Generator comparison" }),
      ).toContainText("Comparing 2/3");
      await build.locator(".buildOption").first().scrollIntoViewIfNeeded();
      await openTool(page, "Insights");
      await expect(
        page.locator("#chartForecastSupplyDemand canvas"),
      ).toBeVisible();
    } else {
      const battery = build.locator(".buildOption").filter({
        has: page.getByRole("button", {
          name: "Review purchase of Lithium Battery",
          exact: true,
        }),
      });
      await battery.getByRole("button", { name: /Show.*details/ }).click();
      await expect(
        battery.getByRole("button", { name: /Hide.*details/ }),
      ).toBeVisible();
    }
  } else if (scene.view === "programs") {
    await openTool(page, "Programs");
    await expect(page.locator("#rateSlider input")).toBeVisible();
    await openTool(page, "Insights");
    await expect(
      page.locator("#chartForecastSupplyDemand canvas"),
    ).toBeVisible();
  } else {
    const intertie = page.locator(".transmissionLine").first();
    await intertie.locator(".facilityDisclosure").click();
    await expect(intertie.locator(".facilityDisclosure")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(intertie).not.toContainText("Building");
    await intertie.scrollIntoViewIfNeeded();
  }
  await page.mouse.move(0, 0);
  // Wait for real fonts, chart workers and tool transitions before recording the UI.
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".MuiCircularProgress-root")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(500);
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
