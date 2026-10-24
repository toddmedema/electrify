import { expect, test } from "./fixtures";
import { openPane, openBuild } from "./layout";
import path from "node:path";
import { editSavedGame } from "./save-fixture";
import { MINUTES_PER_MONTH } from "../src/helpers/DateTime";

// Exercise pane width rather than assuming a viewport implies a column count.
// Only one project runs this explicit matrix to avoid duplicating it per project.
for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [360, 390, 460, 540, 768, 1024, 1440]) {
    test(`expanded facility alignment at ${width}px in ${colorScheme}`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-chromium");
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme });
      await page.addInitScript(() => window.localStorage.clear());
      await page.goto("/?scenario=108");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const facilities = page.locator(".facilities:visible");
      await openPane(
        facilities,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );

      // Hydro exercises long captions; gas adds upkeep/start costs; storage has charge/cycles.
      for (const name of ["Hydro", "Natural Gas CC", "Battery"]) {
        const row = facilities.locator(".facilityRow").filter({
          has: page.locator(".facilityName", {
            hasText: new RegExp(`^${name}$`),
          }),
        });
        await row.locator(".facilityDisclosure").click();
        const details = row.locator(".facilityDetails");
        await expect(details).toBeVisible();
        await expect(
          details.getByRole("heading", { name: "Operation" }),
        ).toBeVisible();
        await expect(
          details.getByRole("heading", { name: "Economics" }),
        ).toBeVisible();
        const geometry = await details.evaluate((element) => {
          const groups = Array.from(element.querySelectorAll(".facilityStats"));
          const sections = Array.from(
            element.querySelectorAll(".facilityDetailSection"),
          );
          return {
            widths: groups.map((group) => group.getBoundingClientRect().width),
            counts: groups.map((group) => group.children.length),
            aligned: groups.every((group) => {
              const cells = Array.from(
                group.querySelectorAll(".facilityStat"),
              ).map((cell) => cell.getBoundingClientRect());
              const firstRow = cells.filter(
                (cell) => Math.abs(cell.top - cells[0].top) < 1,
              );
              return cells.every(
                (cell, index) =>
                  Math.abs(cell.width - cells[0].width) < 1 &&
                  Math.abs(cell.left - firstRow[index % firstRow.length].left) <
                    1,
              );
            }),
            columns: groups.map((group) => {
              const cells = Array.from(group.children);
              const firstTop = cells[0].getBoundingClientRect().top;
              return cells.filter(
                (cell) =>
                  Math.abs(cell.getBoundingClientRect().top - firstTop) < 1,
              ).length;
            }),
            overflow: Array.from(
              element.querySelectorAll<HTMLElement>(".facilityStat"),
            ).some((stat) => stat.scrollWidth > stat.clientWidth + 1),
            grouped: Array.from(
              element.querySelectorAll(".facilityStat"),
            ).every((stat) => {
              const label = stat.querySelector("dt")!.getBoundingClientRect();
              const value = stat.querySelector("dd")!.getBoundingClientRect();
              return Math.abs(value.top - label.bottom - 4) < 1;
            }),
            sectionGaps: sections.slice(1).map((section, index) => {
              const heading =
                section.firstElementChild!.getBoundingClientRect();
              const previous =
                sections[index].lastElementChild!.getBoundingClientRect();
              return heading.top - previous.bottom;
            }),
            initialGap:
              sections[0].firstElementChild!.getBoundingClientRect().top -
              sections[0].getBoundingClientRect().top,
          };
        });
        expect(geometry.columns).toEqual(
          geometry.counts.map((count, index) =>
            Math.min(
              count,
              Math.max(
                1,
                Math.floor((geometry.widths[index] + 16) / (132 + 16)),
              ),
            ),
          ),
        );
        if (name === "Hydro") {
          const water = details.getByRole("region", {
            name: "Water",
            exact: true,
          });
          const outlook = water.locator(".facilityWaterOutlook");
          await expect(outlook).toBeVisible();
          const statsBounds = (await water
            .locator(".facilityStats")
            .boundingBox())!;
          const outlookBounds = (await outlook.boundingBox())!;
          if (width >= 768) {
            expect(outlookBounds.y).toBeCloseTo(statsBounds.y, 0);
            expect(outlookBounds.x).toBeGreaterThan(
              statsBounds.x + statsBounds.width,
            );
          } else if (width <= 390) {
            expect(outlookBounds.y).toBeGreaterThan(
              statsBounds.y + statsBounds.height,
            );
          }
          if (
            process.env.REVIEW_SCREENSHOT_DIR &&
            ((width === 1440 && colorScheme === "light") ||
              (width === 390 && colorScheme === "dark"))
          ) {
            await row.scrollIntoViewIfNeeded();
            await page.mouse.move(0, 0);
            await page.screenshot({
              path: path.join(
                process.env.REVIEW_SCREENSHOT_DIR,
                `hydro-${width}-${colorScheme}.png`,
              ),
              animations: "disabled",
            });
          }
        }
        expect(geometry.overflow).toBe(false);
        expect(geometry.aligned).toBe(true);
        expect(geometry.grouped).toBe(true);
        for (const gap of geometry.sectionGaps)
          expect(gap).toBeCloseTo(geometry.initialGap, 0);
        const labels = row.locator(".facilityActionLabel");
        for (const label of await labels.all())
          await expect(label).toBeVisible();
        expect(
          await row.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ).toBe(true);
        await row.locator(".facilityDisclosure").click();
      }
    });
  }
}

test("reduced output stays inline beside capacity and fuel history shares the grid", async ({
  page,
}, info) => {
  if (info.project.name === "desktop-chromium")
    await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("theme", "dark");
  });
  await page.goto("/?scenario=108");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  // Let a real month complete so the save keeps its scenario receipts and fuel history.
  const appbar = page.locator("#appbar:visible").first();
  await appbar
    .getByRole("button", { name: "normal speed", exact: true })
    .click();
  await expect(appbar).toContainText("Feb 2023");
  await appbar.getByRole("button", { name: "pause", exact: true }).click();
  await editSavedGame(page, ({ game }) => {
    const gas = game.facilities.find(
      (facility) => facility.name === "Natural Gas CC",
    )!;
    gas.annualOutputDegradation = 0.005;
    gas.minuteOperational = game.date.minute - 0.7 * 12 * MINUTES_PER_MONTH;
  });
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const row = page.locator(
    '.facilities:visible .facilityRow[data-facility="Natural Gas CC"]',
  );
  await row.locator(".facilityDisclosure").click();
  const operation = row.getByRole("region", { name: "Operation" });
  await expect(operation.getByRole("term").nth(1)).toHaveText(
    "Current max output",
  );
  const output = operation.getByRole("definition").nth(1);
  await expect(output).toHaveText("259MW (<100%)");
  expect(
    await output.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects().length;
    }),
  ).toBe(1);
  const economics = row.getByRole("region", { name: "Economics" });
  await expect(economics.locator(".facilityFuelTrend")).toBeVisible();
  if (info.project.name === "desktop-chromium") {
    const positions = await economics
      .locator(".facilityStat")
      .evaluateAll((stats) =>
        stats.map((stat) => stat.getBoundingClientRect().top),
      );
    expect(positions).toHaveLength(6);
    expect(new Set(positions).size).toBe(1);
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await row.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          "pr-facility-desktop.png",
        ),
        animations: "disabled",
      });
    }
  }
});

test("expanded details reflow in a resized window and at 200% magnification", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  // Facilities fills the window, so a narrow window is a narrow pane.
  await page.setViewportSize({ width: 500, height: 1000 });
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/?scenario=108");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const facilities = page.locator(".facilities:visible");
  await expect(facilities).toBeVisible();
  const row = facilities.locator(".facilityRow").filter({
    has: page.locator(".facilityName", { hasText: /^Natural Gas CC$/ }),
  });
  await row.locator(".facilityDisclosure").click();
  const grid = row.locator(".facilityStats").first();
  const columns = () =>
    grid.evaluate((element) => {
      const cells = Array.from(element.children);
      const firstTop = cells[0].getBoundingClientRect().top;
      return cells.filter(
        (cell) => Math.abs(cell.getBoundingClientRect().top - firstTop) < 1,
      ).length;
    });
  await expect.poll(columns).toBeGreaterThanOrEqual(1);
  const narrowColumns = await columns();
  expect(
    await row.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(columns).toBeGreaterThan(narrowColumns);
  const wideColumns = await columns();
  // CSS zoom magnifies text, controls and spacing together while the pane keeps its allotted width.
  await facilities.evaluate((element) => {
    (element as HTMLElement).style.zoom = "2";
  });
  await expect.poll(columns).toBeLessThan(wideColumns);
  await expect.poll(columns).toBeGreaterThanOrEqual(1);
  expect(
    await row.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  for (const label of await row.locator(".facilityActionLabel").all())
    await expect(label).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`construction details omit operating results in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    await openBuild(page);
    await page.locator(".button-buildGenerator").click();
    await page
      .getByRole("button", { name: "Review purchase of Solar", exact: true })
      .click();
    await page.getByRole("button", { name: "Pay cash", exact: true }).click();
    const row = pane.locator('.facilityRow[data-facility="Solar"]');
    await row.locator(".facilityDisclosure").click();
    await expect(row).toContainText(/Building \d+%/);
    await expect(row.getByText("Standard panels", { exact: true })).toHaveCount(
      0,
    );
    await expect(row.getByText("Move up", { exact: true })).toHaveCount(0);
    await expect(row.getByText("Move down", { exact: true })).toHaveCount(0);
    const fill = row.locator(".constructionProgressFill");
    const speed = (name: string) =>
      page
        .locator("#appbar:visible")
        .getByRole("button", { name, exact: true })
        .first();
    await speed("normal speed").click();
    await expect
      .poll(() =>
        fill.evaluate(
          (el) => getComputedStyle(el, "::before").animationPlayState,
        ),
      )
      .toBe("running");
    await speed("pause").click();
    await expect
      .poll(() =>
        fill.evaluate(
          (el) => getComputedStyle(el, "::before").animationPlayState,
        ),
      )
      .toBe("paused");
    await expect(row.locator(".facilityDisclosure")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(row.getByRole("region", { name: "Operation" })).toHaveCount(0);
    await expect(row.getByRole("region", { name: "Economics" })).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect(page.locator(".snackbarContent")).toBeHidden();
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("facility-construction.png"),
    });
  });
}
