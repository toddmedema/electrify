// Capture real gameplay through public controls. No game state or rendered content is injected.
const fs = require("node:fs");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");

const folder = __dirname;
const output = path.join(folder, "screenshots");
const baseURL = process.env.ELECTRIFY_CAPTURE_URL || "http://127.0.0.1:3190";

const shots = [
  {
    file: "01-grid-overview-dark.png",
    scenario: 108,
    theme: "dark",
    action: "overview",
  },
  {
    file: "02-generator-comparison-light.png",
    scenario: 101,
    theme: "light",
    action: "generators",
  },
  {
    file: "03-storage-planning-dark.png",
    scenario: 106,
    theme: "dark",
    action: "storage",
  },
  {
    file: "04-customer-programs-light.png",
    scenario: 106,
    theme: "light",
    action: "programs",
  },
  {
    file: "05-intertie-trading-dark.png",
    scenario: 101,
    theme: "dark",
    action: "interties",
  },
  {
    file: "06-weather-forecast-light.png",
    scenario: 108,
    theme: "light",
    action: "forecast",
  },
];

async function capture() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const only = process.argv[2];
  const records = only
    ? JSON.parse(
        fs.readFileSync(path.join(folder, "screenshots.json"), "utf8"),
      ).filter((entry) => shots.some((shot) => shot.file === entry.file))
    : [];
  try {
    for (const shot of shots.filter(
      (candidate) => !only || candidate.file.startsWith(only),
    )) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1.5,
        colorScheme: shot.theme,
        locale: "en-US",
        timezoneId: "UTC",
      });
      await context.addInitScript((theme) => {
        localStorage.setItem("theme", theme);
        localStorage.setItem("electrify-cloud-save-prompt-seen", "true");
        localStorage.setItem(
          "insightsLayers",
          JSON.stringify(["supplyDemand", "cash"]),
        );
      }, shot.theme);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${baseURL}/?scenario=${shot.scenario}`);
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click({ timeout: 90000 });
      await expect(page.locator(".insights:visible")).toBeVisible({
        timeout: 60000,
      });
      await page
        .getByRole("button", { name: "fast speed", exact: true })
        .click();
      await expect(
        page.locator(".gameStatusValue.weak:visible").first(),
      ).not.toContainText("Jan", { timeout: 30000 });
      await page.getByRole("button", { name: "pause", exact: true }).click();
      const status = await page.locator("#appbar:visible").innerText();
      if (["generators", "storage", "interties"].includes(shot.action)) {
        await page.locator(".button-buildFacility").click();
        const category = {
          generators: "Generator",
          storage: "Storage",
          interties: "Intertie",
        }[shot.action];
        await page.locator(`.button-build${category}`).click();
        if (shot.action === "generators") {
          await expect(page.locator(".buildOption").first()).toBeVisible();
          await page
            .getByRole("button", {
              name: "Compare Natural Gas CC",
              exact: true,
            })
            .click();
          await page
            .getByRole("button", { name: "Compare Wind", exact: true })
            .click();
          await page.locator(".buildOption").first().scrollIntoViewIfNeeded();
          await expect(
            page.getByRole("region", { name: "Generator comparison" }),
          ).toContainText("Comparing 2/3");
        } else if (shot.action === "storage") {
          await expect(page.locator(".buildOption").first()).toBeVisible();
          const capacity = page.getByRole("slider", { name: /^Capacity/ });
          await capacity.press("Home");
          for (let tick = 0; tick < 15; tick += 1)
            await capacity.press("ArrowRight");
          await expect(page.locator("#construction-capacity")).toContainText(
            "200MWh",
          );
          await expect(
            page.getByRole("button", { name: /Review purchase of Battery/ }),
          ).toBeEnabled();
        } else {
          await expect(page.locator(".constructionInterties")).toBeVisible();
          const header = page.locator(
            ".buildFacilities > .constructionHeader:visible",
          );
          await expect(header).toHaveCount(1);
          const title = header.locator(".constructionTitle");
          await title.scrollIntoViewIfNeeded();
          await expect(title).toContainText("Build");
          expect((await title.boundingBox()).y).toBeGreaterThanOrEqual(0);
        }
      } else if (shot.action === "programs") {
        await page
          .getByRole("button", { name: "Customer programs", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toBeVisible();
      } else if (shot.action === "forecast") {
        for (let step = 0; step < 12; step += 1) {
          await page
            .getByRole("button", { name: "Pan later", exact: true })
            .click();
        }
        await expect(page.locator(".insightsViewportDate")).toContainText(
          "2026",
        );
      }
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(1275, 715);
      await page.screenshot({
        path: path.join(output, shot.file),
        animations: "disabled",
      });
      if (errors.length) throw new Error(`${shot.file}: ${errors.join("; ")}`);
      const record = {
        ...shot,
        size: [1920, 1080],
        viewport: [1280, 720],
        deviceScaleFactor: 1.5,
        gameStatus: status.replaceAll("\n", " "),
      };
      const previous = records.findIndex((entry) => entry.file === shot.file);
      if (previous >= 0) records[previous] = record;
      else records.push(record);
      console.log(`Captured ${shot.file}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  records.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(
    path.join(folder, "screenshots.json"),
    `${JSON.stringify(records, null, 2)}\n`,
  );
}

capture().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
